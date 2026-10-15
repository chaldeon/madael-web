import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployee } from '@/lib/notify';
import { hitungStatusTelat } from '@/lib/attendanceStatus';
import { jamJakarta } from '@/lib/serverTime';
import { friendlyError } from '@/lib/errorMessage';

// Sama dengan formatTanggal di lib/absensiKaryawanConfig.js (dengan nama hari),
// supaya teks notifikasi tidak berubah dibanding saat approve masih di browser.
function formatTanggalId(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

const PESAN_BUKAN_PENDING =
  'Pengajuan ini sudah tidak berstatus menunggu (mungkin dibatalkan karyawan atau sudah diproses). Daftar dimuat ulang.';

// POST /api/attendance/koreksi/[id]/approve   (tanpa body)
// Superadmin menyetujui pengajuan koreksi absensi mandiri karyawan dan
// menerapkannya ke tabel attendance.
//
// Dulu dilakukan dari browser: attendance di-update lebih dulu, baru status
// koreksi diubah ke 'approved'. Kalau karyawan membatalkan di sela dua langkah
// itu, data absensi sudah terlanjur berubah. Di sini urutannya dibalik, sama
// seperti app/api/leave-requests/[id]/decision/route.js:
//   1. KLAIM  : UPDATE bersyarat pending -> approved (hanya satu pemenang;
//               pembatalan karyawan memakai syarat 'pending' yang sama, jadi
//               setelah klaim berhasil karyawan tidak bisa membatalkan lagi).
//   2. TERAPKAN: tulis ke attendance (satu statement, atomik).
//   3. ROLLBACK: kalau langkah 2 gagal, klaim dikembalikan ke 'pending'.
//
// Semua nilai (jam, jadwal, toleransi) dibaca ulang dari database; body dari
// browser tidak dipakai, jadi klien tidak bisa menyisipkan data absensi sendiri.
// Hanya akun aktif dengan modul absensi_admin DAN superadmin (sama seperti
// halaman Kelola Absensi Tim dan /api/attendance/justify).
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['absensi_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;
    if (!emp.is_superadmin) {
      return NextResponse.json(
        { error: 'Hanya superadmin yang boleh menyetujui koreksi absensi.' },
        { status: 403 }
      );
    }

    const { data: row, error: rowError } = await admin
      .from('attendance_corrections')
      .select('*')
      .eq('id', id)
      .not('requested_by', 'is', null) // hanya pengajuan mandiri karyawan
      .maybeSingle();
    if (rowError) {
      return NextResponse.json(
        { error: `Gagal memuat pengajuan koreksi: ${friendlyError(rowError, 'terjadi kesalahan pada server.', { context: 'Muat pengajuan koreksi absensi' })}` },
        { status: 500 }
      );
    }
    if (!row) {
      return NextResponse.json({ error: 'Pengajuan koreksi tidak ditemukan.' }, { status: 404 });
    }
    if (row.status !== 'pending') {
      return NextResponse.json({ error: PESAN_BUKAN_PENDING, status: row.status }, { status: 409 });
    }

    // Jadwal dibaca di sini (sebelum klaim) supaya error baca tidak perlu rollback.
    const { data: schedule, error: scheduleError } = await admin
      .from('work_schedule')
      .select('jam_masuk, toleransi_menit')
      .eq('employee_id', row.employee_id)
      .maybeSingle();
    if (scheduleError) {
      return NextResponse.json(
        { error: `Gagal memuat jadwal kerja: ${friendlyError(scheduleError, 'terjadi kesalahan pada server.', { context: 'Muat jadwal kerja untuk koreksi absensi' })}` },
        { status: 500 }
      );
    }
    const toleransiMenit = Number(schedule?.toleransi_menit) || 0;
    const statusTelat =
      !!schedule && !!row.after_clock_in
        ? hitungStatusTelat({
            jamClockIn: jamJakarta(new Date(row.after_clock_in)),
            jamMasuk: schedule.jam_masuk,
            toleransiMenit,
          })
        : false;

    // Nilai kolom review sebelum klaim, disimpan eksplisit untuk rollback.
    const awal = {
      reviewed_by: row.reviewed_by ?? null,
      reviewed_at: row.reviewed_at ?? null,
      corrected_by: row.corrected_by ?? null,
    };

    // 1. KLAIM: pending -> approved. reviewed_at dipakai juga sebagai "sidik jari"
    // klaim ini kalau nanti perlu rollback.
    const sekarang = new Date().toISOString();
    const { data: klaim, error: klaimError } = await admin
      .from('attendance_corrections')
      .update({
        status: 'approved',
        reviewed_by: emp.id,
        reviewed_at: sekarang,
        corrected_by: emp.id,
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (klaimError) {
      console.error('Klaim koreksi absensi error:', klaimError);
      return NextResponse.json(
        { error: `Gagal memproses pengajuan koreksi: ${friendlyError(klaimError, 'terjadi kesalahan pada server.', { context: 'Klaim koreksi absensi' })}` },
        { status: 500 }
      );
    }
    if (!klaim) {
      // Kalah balapan: dibatalkan karyawan / diproses superadmin lain.
      return NextResponse.json({ error: PESAN_BUKAN_PENDING }, { status: 409 });
    }

    // Kembalikan klaim ke 'pending' (hanya kalau klaim ini yang masih berlaku).
    const batalkanKlaim = async () => {
      const { data: kembali, error: kembaliError } = await admin
        .from('attendance_corrections')
        .update({ status: 'pending', ...awal })
        .eq('id', id)
        .eq('status', 'approved')
        .eq('reviewed_at', sekarang)
        .select('id')
        .maybeSingle();
      return !kembaliError && !!kembali;
    };

    // Rollback + balasan error. Kalau rollback pun gagal, beri tahu dengan jelas
    // karena status 'approved' tidak sesuai dengan data absensi.
    const gagalTerapkan = async (status, pesan) => {
      const berhasil = await batalkanKlaim();
      if (!berhasil) {
        console.error('Rollback klaim koreksi absensi GAGAL, id:', id);
        return NextResponse.json(
          {
            error: `${pesan} Selain itu status pengajuan gagal dikembalikan ke menunggu, padahal data absensi BELUM diperbarui. Hubungi pengembang sebelum memproses ulang.`,
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: pesan }, { status });
    };

    // 2. TERAPKAN ke attendance. Cari baris tujuan: attendance_id dari pengajuan,
    // kalau tidak ada/sudah terhapus, cari berdasarkan karyawan + tanggal (mis.
    // karyawan clock-in setelah mengajukan). Kalau tetap tidak ada, buat baru.
    let attendanceId = null;
    if (row.attendance_id) {
      const { data: byId, error: byIdError } = await admin
        .from('attendance')
        .select('id')
        .eq('id', row.attendance_id)
        .maybeSingle();
      if (byIdError) {
        console.error('Cari absensi (id) error:', byIdError);
        return gagalTerapkan(500, `Gagal memuat data absensi: ${friendlyError(byIdError, 'terjadi kesalahan pada server.', { context: 'Cari absensi untuk koreksi' })}`);
      }
      attendanceId = byId?.id ?? null;
    }
    if (!attendanceId) {
      const { data: byTanggal, error: byTanggalError } = await admin
        .from('attendance')
        .select('id')
        .eq('employee_id', row.employee_id)
        .eq('tanggal', row.tanggal)
        .maybeSingle();
      if (byTanggalError) {
        console.error('Cari absensi (tanggal) error:', byTanggalError);
        return gagalTerapkan(500, `Gagal memuat data absensi: ${friendlyError(byTanggalError, 'terjadi kesalahan pada server.', { context: 'Cari absensi untuk koreksi' })}`);
      }
      attendanceId = byTanggal?.id ?? null;
    }

    const nilai = {
      clock_in: row.after_clock_in,
      clock_out: row.after_clock_out,
      status_telat: statusTelat,
      toleransi_menit: toleransiMenit,
      wajah_terverifikasi: true,
    };

    let tulis;
    if (attendanceId) {
      tulis = await admin
        .from('attendance')
        .update(nilai)
        .eq('id', attendanceId)
        .select('id')
        .maybeSingle();
    } else {
      tulis = await admin
        .from('attendance')
        .insert([{ employee_id: row.employee_id, tanggal: row.tanggal, ...nilai }])
        .select('id')
        .maybeSingle();
    }
    if (tulis.error || !tulis.data) {
      console.error('Terapkan koreksi absensi error:', tulis.error);
      if (tulis.error?.code === '23505') {
        return gagalTerapkan(409, 'Data absensi untuk tanggal ini baru saja dibuat proses lain. Coba setujui lagi.');
      }
      return gagalTerapkan(
        500,
        tulis.error
          ? `Gagal memperbarui data absensi: ${friendlyError(tulis.error, 'terjadi kesalahan pada server.', { context: 'Terapkan koreksi absensi' })}`
          : 'Data absensi tidak ditemukan saat diperbarui.'
      );
    }
    const attendanceIdFinal = tulis.data.id;

    // Tautkan koreksi ke baris absensinya (perlu kalau baris baru dibuat, atau
    // attendance_id lama sudah tidak berlaku). Absensi sudah benar di titik ini,
    // jadi kalau tautan gagal cukup beri peringatan, jangan rollback.
    let warning = null;
    if (row.attendance_id !== attendanceIdFinal) {
      const { error: tautError } = await admin
        .from('attendance_corrections')
        .update({ attendance_id: attendanceIdFinal })
        .eq('id', id)
        .eq('status', 'approved');
      if (tautError) {
        console.error('Tautkan koreksi ke absensi error:', tautError);
        warning = 'Koreksi disetujui dan absensi sudah diperbarui, tetapi tautan ke data absensi gagal disimpan.';
      }
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'approve_koreksi_absensi',
      targetTable: 'attendance_corrections',
      targetId: row.id,
      detail: { employee_id: row.employee_id, tanggal: row.tanggal, attendance_id: attendanceIdFinal },
    });

    await notifyEmployee(admin, {
      userId: row.employee_id,
      tipe: 'koreksi_absensi_disetujui',
      pesan: `Pengajuan koreksi absensi tanggal ${formatTanggalId(row.tanggal)} disetujui. Data absensi kamu sudah diperbarui.`,
      link: '/employee/absensi',
    });

    return NextResponse.json({
      success: true,
      attendance_id: attendanceIdFinal,
      reviewed_at: sekarang,
      warning,
    });
  } catch (err) {
    console.error('Approve koreksi absensi error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
