import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { notifySuperadmins } from '@/lib/notify';
import { friendlyError } from '@/lib/errorMessage';
import { todayJakarta } from '@/lib/serverTime';
import { formatTanggal } from '@/lib/leaveServer';
import { uploadAttendanceEvidenceToDrive, deleteEmployeeDocumentFromDrive } from '@/lib/googleDrive';
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL } from '@/lib/uploadLimits';
import { periksaFileUpload, hashIsiFile } from '@/lib/uploadServer';
import { BUKTI_KOREKSI_MIME, validasiPengajuanKoreksi, waktuWibKeIso } from '@/lib/attendanceCorrection';

const PESAN_BUKTI_GANDA =
  'Foto bukti ini sudah dipakai di pengajuan koreksi lain yang masih berjalan atau sudah disetujui. Upload foto bukti yang berbeda.';

// POST /api/attendance/koreksi   multipart/form-data:
//   tanggal, jamMasuk?, jamPulang?, alasan, foto (file)
// Karyawan mengajukan koreksi absensi mandiri. Dulu foto di-upload lewat
// /api/attendance/koreksi-bukti lalu baris pengajuan di-INSERT dari browser
// dengan nilai yang dikirim klien apa adanya (before_*, after_*, tautan Drive,
// bahkan employee_id/requested_by) — padahal approve menerapkan after_* itu ke
// tabel attendance. Sekarang semuanya diturunkan/dicek di server:
// - tanggal valid, bukan masa depan, maks 60 hari ke belakang (WIB)
// - minimal satu jam (HH:mm); jam dibaca sebagai WIB, bukan zona waktu perangkat
// - after_* = jam yang diajukan, atau nilai absensi yang ada kalau tidak diisi;
//   before_* dibaca dari tabel attendance, bukan dari klien
// - clock out harus setelah clock in; pengajuan yang tidak mengubah apa pun ditolak
// - satu karyawan hanya boleh punya satu pengajuan pending per tanggal (409)
// - foto bukti wajib: JPG/PNG, maks 4MB, isi dicocokkan dengan format; foto
//   dengan isi yang sama dengan pengajuan lain yang pending/disetujui ditolak (409)
// employee_id dan requested_by selalu dari sesi. Upload ke Drive dilakukan
// paling akhir, setelah semua validasi lolos.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['absensi']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: 'Data permintaan tidak valid.' }, { status: 400 });
    }

    const input = validasiPengajuanKoreksi({
      tanggal: formData.get('tanggal'),
      jamMasuk: formData.get('jamMasuk'),
      jamPulang: formData.get('jamPulang'),
      alasan: formData.get('alasan'),
      hariIni: todayJakarta(),
    });
    if (input.error) {
      return NextResponse.json({ error: input.error }, { status: 400 });
    }

    const file = formData.get('foto');
    if (!file || typeof file === 'string' || file.size === 0) {
      return NextResponse.json(
        { error: 'Foto bukti wajib diupload (mis. foto absen fisik, selfie di lokasi kerja, dsb).' },
        { status: 400 }
      );
    }
    const periksa = await periksaFileUpload(file, {
      mimeAllowed: BUKTI_KOREKSI_MIME,
      maksBytes: UPLOAD_MAX_BYTES,
      labelJenis: 'JPG atau PNG',
      labelUkuran: UPLOAD_MAX_LABEL,
      nama: 'foto',
    });
    if (periksa.error) {
      return NextResponse.json({ error: periksa.error }, { status: 400 });
    }
    const { buffer, mime, ext } = periksa;
    const fotoHash = hashIsiFile(buffer);

    // Nilai sebelum dari database (bukan dari klien).
    const { data: existing, error: existingError } = await admin
      .from('attendance')
      .select('id, clock_in, clock_out, status_telat')
      .eq('employee_id', emp.id)
      .eq('tanggal', input.tanggal)
      .maybeSingle();
    if (existingError) {
      console.error('Ajukan koreksi — baca absensi error:', existingError);
      return NextResponse.json(
        { error: `Gagal memuat data absensi: ${friendlyError(existingError, 'terjadi kesalahan pada server.', { context: 'Muat absensi untuk pengajuan koreksi' })}` },
        { status: 500 }
      );
    }

    const afterClockIn = input.jamMasuk ? waktuWibKeIso(input.tanggal, input.jamMasuk) : (existing?.clock_in || null);
    const afterClockOut = input.jamPulang ? waktuWibKeIso(input.tanggal, input.jamPulang) : (existing?.clock_out || null);

    if (afterClockOut && !afterClockIn) {
      return NextResponse.json(
        { error: 'Belum ada data jam masuk di tanggal itu. Isi jam masuk juga kalau mengajukan jam pulang.' },
        { status: 400 }
      );
    }
    if (afterClockIn && afterClockOut && new Date(afterClockOut) <= new Date(afterClockIn)) {
      return NextResponse.json({ error: 'Jam pulang harus setelah jam masuk.' }, { status: 400 });
    }
    const sama = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
    if (existing && sama(afterClockIn, existing.clock_in) && sama(afterClockOut, existing.clock_out)) {
      return NextResponse.json(
        { error: 'Jam yang diajukan sama dengan data absensi saat ini, jadi tidak ada yang perlu dikoreksi.' },
        { status: 400 }
      );
    }

    // Satu pengajuan pending per karyawan per tanggal.
    const { data: pendingSama, error: pendingError } = await admin
      .from('attendance_corrections')
      .select('id')
      .eq('employee_id', emp.id)
      .eq('tanggal', input.tanggal)
      .eq('status', 'pending')
      .not('requested_by', 'is', null)
      .limit(1);
    if (pendingError) {
      console.error('Ajukan koreksi — cek pending error:', pendingError);
      return NextResponse.json(
        { error: `Gagal memeriksa pengajuan lain: ${friendlyError(pendingError, 'terjadi kesalahan pada server.', { context: 'Cek pengajuan koreksi pending' })}` },
        { status: 500 }
      );
    }
    if (pendingSama && pendingSama.length > 0) {
      return NextResponse.json(
        { error: 'Kamu sudah punya pengajuan koreksi yang menunggu untuk tanggal ini. Batalkan dulu kalau ingin mengajukan ulang.' },
        { status: 409 }
      );
    }

    // Foto bukti ganda (siapa pun pemiliknya, tanggal mana pun).
    const { data: gandaRows, error: gandaError } = await admin
      .from('attendance_corrections')
      .select('id')
      .eq('foto_bukti_hash', fotoHash)
      .in('status', ['pending', 'approved'])
      .limit(1);
    if (gandaError) {
      console.error('Ajukan koreksi — cek foto ganda error:', gandaError);
      return NextResponse.json(
        { error: `Gagal memeriksa foto bukti: ${friendlyError(gandaError, 'terjadi kesalahan pada server.', { context: 'Cek foto bukti ganda koreksi' })}` },
        { status: 500 }
      );
    }
    if (gandaRows && gandaRows.length > 0) {
      return NextResponse.json({ error: PESAN_BUKTI_GANDA }, { status: 409 });
    }

    let bukti;
    try {
      const fileName = `bukti_${input.tanggal}_${Date.now()}.${ext}`;
      const up = await uploadAttendanceEvidenceToDrive(buffer, fileName, mime, `${emp.nama} (${emp.id.slice(0, 8)})`);
      bukti = { driveId: up.fileId, driveUrl: up.webViewLink };
    } catch (driveError) {
      console.error('Google Drive upload error (koreksi absensi):', driveError);
      return NextResponse.json({ error: 'Gagal mengupload foto bukti ke Google Drive. Coba lagi.' }, { status: 500 });
    }

    const { data, error: insertError } = await admin
      .from('attendance_corrections')
      .insert([{
        attendance_id: existing?.id || null,
        employee_id: emp.id,
        requested_by: emp.id,
        tanggal: input.tanggal,
        status: 'pending',
        alasan: input.alasan,
        before_clock_in: existing?.clock_in || null,
        before_clock_out: existing?.clock_out || null,
        before_status_telat: existing?.status_telat ?? null,
        after_clock_in: afterClockIn,
        after_clock_out: afterClockOut,
        foto_bukti_url: bukti.driveUrl,
        foto_bukti_drive_id: bukti.driveId,
        foto_bukti_hash: fotoHash,
      }])
      .select()
      .single();

    if (insertError) {
      try {
        await deleteEmployeeDocumentFromDrive(bukti.driveId);
      } catch (cleanupError) {
        console.error('Gagal hapus foto bukti koreksi yatim:', bukti.driveId, cleanupError);
      }
      // 23505 = indeks unik foto_bukti_hash: dua pengajuan dengan foto sama
      // masuk bersamaan, cek di atas lolos untuk keduanya.
      if (insertError.code === '23505') {
        return NextResponse.json({ error: PESAN_BUKTI_GANDA }, { status: 409 });
      }
      console.error('Ajukan koreksi absensi error:', insertError);
      return NextResponse.json(
        { error: `Gagal mengirim pengajuan koreksi: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Kirim pengajuan koreksi absensi' })}` },
        { status: 500 }
      );
    }

    // Hanya superadmin yang berwenang approve (modul absensi_admin superadminOnly).
    await notifySuperadmins(admin, {
      tipe: 'koreksi_absensi_diajukan',
      pesan: `${emp.nama || 'Karyawan'} mengajukan koreksi absensi tanggal ${formatTanggal(input.tanggal)}.`,
      link: '/employee/absensi/karyawan',
    });

    return NextResponse.json({ success: true, correction: data }, { status: 201 });
  } catch (err) {
    console.error('Ajukan koreksi absensi error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
