import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployee } from '@/lib/notify';
import { friendlyError } from '@/lib/errorMessage';

// Sama dengan formatTanggal di halaman koreksi (dengan nama hari), supaya teks
// notifikasi tidak berubah dibanding saat proses ini masih jalan di browser.
function formatTanggalId(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Timestamp opsional dari body: kosong -> null, tidak valid -> undefined.
function parseWaktu(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function tanggalValid(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

// Syarat "kolom masih bernilai X" untuk UPDATE bersyarat (null butuh IS NULL).
function syarat(query, kolom, nilai) {
  return nilai === null || nilai === undefined ? query.is(kolom, null) : query.eq(kolom, nilai);
}

// POST /api/attendance/koreksi/manual
// body: { attendanceId?, employeeId?, tanggal?, clockIn, clockOut, statusTelat, alasan }
//   - attendanceId diisi  -> koreksi record absensi yang sudah ada
//   - attendanceId kosong -> tambah record baru (butuh employeeId + tanggal)
// Koreksi manual oleh HR (superadmin) dari halaman Koreksi Absensi.
//
// Dulu dilakukan dari browser dengan dua tulisan terpisah, sehingga bisa
// setengah jalan: log koreksi tercatat padahal update absensi gagal, atau
// sebaliknya record absensi terbentuk tanpa log (perlu cleanup manual). Tanpa
// transaksi DB, urutan dan kompensasinya dipilih supaya audit tidak pernah
// "bohong":
//
//   Record ada  : 1. baca nilai SEBELUM dari DB (bukan dari browser)
//                 2. tulis log koreksi
//                 3. UPDATE attendance dengan syarat nilainya masih sama seperti
//                    di langkah 1 (kalau sudah berubah: 409, tidak menimpa)
//                 4. kalau langkah 3 gagal -> log dihapus lagi
//   Record baru : 1. INSERT attendance
//                 2. tulis log koreksi
//                 3. kalau langkah 2 gagal -> record baru dihapus lagi
//
// Sisa risiko yang tidak bisa ditutup tanpa transaksi (RPC): proses mati di
// tengah dua langkah itu, atau kompensasi itu sendiri gagal. Kasus kompensasi
// gagal dilaporkan jelas ke pengguna. Log yang tersisa lebih aman daripada
// perubahan absensi tanpa jejak, itu sebabnya log ditulis lebih dulu.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['absensi_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;
    if (!emp.is_superadmin) {
      return NextResponse.json(
        { error: 'Hanya superadmin yang boleh mengoreksi absensi secara manual.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Data permintaan tidak valid.' }, { status: 400 });
    }

    const alasan = typeof body.alasan === 'string' ? body.alasan.trim() : '';
    if (!alasan) {
      return NextResponse.json({ error: 'Alasan koreksi wajib diisi.' }, { status: 400 });
    }
    if (typeof body.statusTelat !== 'boolean') {
      return NextResponse.json({ error: 'Status telat harus true atau false.' }, { status: 400 });
    }
    const statusTelat = body.statusTelat;

    const clockIn = parseWaktu(body.clockIn);
    const clockOut = parseWaktu(body.clockOut);
    if (clockIn === undefined || clockOut === undefined) {
      return NextResponse.json({ error: 'Format jam tidak valid.' }, { status: 400 });
    }
    if (clockOut && !clockIn) {
      return NextResponse.json({ error: 'Jam Clock In wajib diisi kalau Jam Clock Out diisi.' }, { status: 400 });
    }
    if (clockIn && clockOut && new Date(clockOut) <= new Date(clockIn)) {
      return NextResponse.json({ error: 'Jam Clock Out harus lebih besar dari Jam Clock In.' }, { status: 400 });
    }

    const isNew = body.attendanceId === null || body.attendanceId === undefined || body.attendanceId === '';

    // Hapus baris log yang baru ditulis (kompensasi). true = berhasil.
    const hapusLog = async (logId) => {
      const { error } = await admin.from('attendance_corrections').delete().eq('id', logId);
      if (error) console.error('Hapus log koreksi (kompensasi) GAGAL, id:', logId, error);
      return !error;
    };

    // ---------- Record baru ----------
    if (isNew) {
      if (typeof body.employeeId !== 'string' || !body.employeeId || !tanggalValid(body.tanggal)) {
        return NextResponse.json({ error: 'Karyawan dan tanggal wajib diisi dengan benar.' }, { status: 400 });
      }

      const { data: inserted, error: insertError } = await admin
        .from('attendance')
        .insert([{
          employee_id: body.employeeId,
          tanggal: body.tanggal,
          clock_in: clockIn,
          clock_out: clockOut,
          status_telat: statusTelat,
          wajah_terverifikasi: false,
        }])
        .select()
        .single();
      if (insertError) {
        console.error('Buat record absensi manual error:', insertError);
        if (insertError.code === '23505') {
          return NextResponse.json(
            { error: 'Karyawan ini sudah punya record di tanggal itu. Muat ulang halaman dan pakai tombol Koreksi, bukan Tambah Record Baru.' },
            { status: 409 }
          );
        }
        return NextResponse.json(
          { error: friendlyError(insertError, 'Gagal membuat record baru.', { context: 'Buat record absensi manual' }) },
          { status: 500 }
        );
      }

      const { error: logError } = await admin.from('attendance_corrections').insert([{
        attendance_id: inserted.id,
        employee_id: body.employeeId,
        corrected_by: emp.id,
        alasan,
        before_clock_in: null,
        before_clock_out: null,
        before_status_telat: null,
        after_clock_in: clockIn,
        after_clock_out: clockOut,
        after_status_telat: statusTelat,
      }]);
      if (logError) {
        console.error('Log koreksi (record baru) error:', logError);
        // Kompensasi: batalkan record yang baru dibuat supaya tidak ada absensi tanpa jejak.
        const { error: batalError } = await admin.from('attendance').delete().eq('id', inserted.id);
        if (batalError) {
          console.error('Batalkan record absensi baru GAGAL, id:', inserted.id, batalError);
          return NextResponse.json(
            { error: 'Log koreksi gagal disimpan dan record yang baru dibuat gagal dibatalkan. Record absensi tanggal ini sudah ada tanpa log koreksi. Hubungi pengembang.' },
            { status: 500 }
          );
        }
        return NextResponse.json(
          { error: `Gagal menyimpan log koreksi, record baru dibatalkan: ${friendlyError(logError, 'terjadi kesalahan pada server.', { context: 'Log koreksi record baru' })}` },
          { status: 500 }
        );
      }

      await logActivity(admin, {
        userId: emp.id,
        aksi: 'koreksi_absensi_tambah',
        targetTable: 'attendance',
        targetId: inserted.id,
        detail: { employee_id: body.employeeId, tanggal: body.tanggal, alasan },
      });
      await notifyEmployee(admin, {
        userId: body.employeeId,
        tipe: 'absensi_dikoreksi',
        pesan: `Record absensi tanggal ${formatTanggalId(body.tanggal)} ditambahkan oleh admin. Alasan: ${alasan}`,
        link: '/employee/absensi',
      });

      return NextResponse.json({ success: true, attendance: inserted });
    }

    // ---------- Koreksi record yang sudah ada ----------
    const { data: current, error: currentError } = await admin
      .from('attendance')
      .select('id, employee_id, tanggal, clock_in, clock_out, status_telat')
      .eq('id', body.attendanceId)
      .maybeSingle();
    if (currentError) {
      return NextResponse.json(
        { error: `Gagal memuat data absensi: ${friendlyError(currentError, 'terjadi kesalahan pada server.', { context: 'Muat absensi untuk koreksi manual' })}` },
        { status: 500 }
      );
    }
    if (!current) {
      return NextResponse.json({ error: 'Data absensi tidak ditemukan. Muat ulang halaman.' }, { status: 404 });
    }

    const { data: log, error: logError } = await admin
      .from('attendance_corrections')
      .insert([{
        attendance_id: current.id,
        employee_id: current.employee_id,
        corrected_by: emp.id,
        alasan,
        before_clock_in: current.clock_in,
        before_clock_out: current.clock_out,
        before_status_telat: current.status_telat,
        after_clock_in: clockIn,
        after_clock_out: clockOut,
        after_status_telat: statusTelat,
      }])
      .select('id')
      .single();
    if (logError) {
      console.error('Tulis log koreksi error:', logError);
      return NextResponse.json(
        { error: `Gagal menyimpan log koreksi. Koreksi dibatalkan: ${friendlyError(logError, 'terjadi kesalahan pada server.', { context: 'Tulis log koreksi manual' })}` },
        { status: 500 }
      );
    }

    // UPDATE bersyarat: hanya jalan kalau nilai "sebelum" di log masih benar.
    let updateQuery = admin
      .from('attendance')
      .update({ clock_in: clockIn, clock_out: clockOut, status_telat: statusTelat })
      .eq('id', current.id);
    updateQuery = syarat(updateQuery, 'clock_in', current.clock_in);
    updateQuery = syarat(updateQuery, 'clock_out', current.clock_out);
    updateQuery = syarat(updateQuery, 'status_telat', current.status_telat);
    const { data: updated, error: updateError } = await updateQuery.select().maybeSingle();

    if (updateError || !updated) {
      if (updateError) console.error('Update absensi (koreksi manual) error:', updateError);
      const logDihapus = await hapusLog(log.id);
      const lanjutan = logDihapus
        ? ''
        : ' Selain itu log koreksi gagal dihapus padahal absensi belum berubah. Hubungi pengembang.';

      if (updateError) {
        return NextResponse.json(
          { error: `Gagal menyimpan koreksi: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Update absensi koreksi manual' })}${lanjutan}` },
          { status: 500 }
        );
      }
      // Tidak ada baris yang cocok: data diubah proses lain sejak form dibuka.
      return NextResponse.json(
        { error: `Data absensi ini baru saja diubah proses lain. Tutup form ini, muat ulang, lalu koreksi lagi.${lanjutan}` },
        { status: 409 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'koreksi_absensi',
      targetTable: 'attendance',
      targetId: updated.id,
      detail: {
        employee_id: current.employee_id,
        tanggal: current.tanggal,
        alasan,
        before: { clock_in: current.clock_in, clock_out: current.clock_out, status_telat: current.status_telat },
        after: { clock_in: clockIn, clock_out: clockOut, status_telat: statusTelat },
      },
    });
    await notifyEmployee(admin, {
      userId: current.employee_id,
      tipe: 'absensi_dikoreksi',
      pesan: `Record absensi tanggal ${formatTanggalId(current.tanggal)} dikoreksi oleh admin. Alasan: ${alasan}`,
      link: '/employee/absensi',
    });

    return NextResponse.json({ success: true, attendance: updated });
  } catch (err) {
    console.error('Koreksi absensi manual error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
