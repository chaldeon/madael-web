import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { todayJakarta } from '@/lib/serverTime';
import { saveClock, isValidFotoPath } from '@/lib/attendanceClock';
import { verifyConfirmToken } from '@/lib/attendanceConfirmToken';

// POST /api/attendance/clock/confirm
// Langkah 2: menyimpan absensi dari token yang dikeluarkan
// /api/attendance/clock/preview. Yang disimpan adalah PERSIS hasil hitung server
// saat preview — termasuk jam saat foto diambil, bukan jam saat tombol
// konfirmasi ditekan — jadi karyawan yang berlama-lama di layar review tidak
// tiba-tiba jadi telat, dan browser tidak bisa mengubah hasilnya (token
// bertanda tangan; lihat lib/attendanceConfirmToken.js).
//
// body: { token: string, fotoPath: string | null }
//
// Semua kegagalan yang tidak akan berhasil kalau dicoba lagi (token kedaluwarsa,
// sudah absen, dst) dikembalikan dengan `fatal: true` supaya UI menawarkan
// "Ambil Ulang", bukan tombol coba-lagi.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.token !== 'string') {
      return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 });
    }
    const fotoPath = body.fotoPath ?? null;

    const session = await getSessionEmployee('id, status');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { emp } = session;

    const verified = verifyConfirmToken(body.token);
    if (!verified.ok) {
      if (verified.reason === 'expired') {
        return NextResponse.json(
          { error: 'Sesi konfirmasi sudah kedaluwarsa. Ambil foto ulang untuk absen.', fatal: true },
          { status: 410 }
        );
      }
      return NextResponse.json(
        { error: 'Sesi konfirmasi tidak valid. Ambil foto ulang untuk absen.', fatal: true },
        { status: 400 }
      );
    }
    const p = verified.payload;

    // Token milik orang lain / bentuknya tidak dikenali -> tolak.
    if (String(p.emp) !== String(emp.id)) {
      return NextResponse.json({ error: 'Sesi konfirmasi bukan milik akunmu.', fatal: true }, { status: 403 });
    }
    const bentukValid =
      (p.mode === 'in' || p.mode === 'out') &&
      Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
      p.geo && typeof p.geo === 'object' && p.wajah && typeof p.wajah === 'object';
    if (!bentukValid) {
      return NextResponse.json(
        { error: 'Sesi konfirmasi tidak valid. Ambil foto ulang untuk absen.', fatal: true },
        { status: 400 }
      );
    }

    if (!isValidFotoPath(fotoPath, emp.id)) {
      return NextResponse.json({ error: 'Path foto tidak valid.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const now = new Date(p.t); // jam saat preview (server), bukan sekarang
    const tanggal = todayJakarta(now);

    // Jadwal dibaca ulang hanya untuk hitung telat + snapshot toleransi; jam yang
    // dibandingkan tetap jam preview.
    const scheduleRes = p.mode === 'in'
      ? await admin.from('work_schedule').select('jam_masuk, toleransi_menit').eq('employee_id', emp.id).maybeSingle()
      : { data: null, error: null };

    const result = await saveClock(admin, {
      empId: emp.id,
      mode: p.mode,
      now,
      tanggal,
      lat: p.lat,
      lng: p.lng,
      fotoPath,
      geo: {
        dalamRadius: p.geo.dalamRadius ?? null,
        jarakMeter: p.geo.jarakMeter ?? null,
        lokasiNama: p.geo.lokasiNama ?? null,
      },
      wajah: { ok: p.wajah.ok ?? null, distance: p.wajah.distance ?? null },
      schedule: scheduleRes.data,
      scheduleError: scheduleRes.error,
    });

    if (result.fail) {
      return NextResponse.json({ error: result.fail.error, fatal: true }, { status: result.fail.status });
    }
    return NextResponse.json({ data: result.data });
  } catch (err) {
    console.error('Clock confirm error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat menyimpan absensi.' }, { status: 500 });
  }
}