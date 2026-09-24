import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { todayJakarta } from '@/lib/serverTime';
import { evaluateClock, saveClock, toGeo } from '@/lib/attendanceClock';

// POST /api/attendance/clock
// Clock in/out karyawan, SIMPAN LANGSUNG. Dipakai kalau layar konfirmasi
// dilewati (preferensi "Lewati layar konfirmasi"). Kalau layar konfirmasi
// aktif, alurnya lewat /api/attendance/clock/preview lalu /clock/confirm —
// ketiganya memakai logika yang sama di lib/attendanceClock.js.
//
// SEMUA nilai yang menentukan kebenaran absensi — jam, tanggal, status telat,
// jarak geofence, dan verifikasi wajah — dihitung DI SINI, bukan dipercaya dari
// browser. Client hanya mengirim bahan mentah: koordinat GPS, path foto yang
// sudah diupload ke storage, dan descriptor wajah (128 angka) hasil deteksi dari
// frame kamera — bukan kesimpulan cocok/tidaknya, dan bukan flag radius/telat.
//
// body: {
//   mode: 'in' | 'out',
//   lat: number, lng: number,
//   fotoPath: string | null,
//   descriptor: number[] | null | undefined
//     - array   : wajah terdeteksi di frame, ini descriptor-nya
//     - null    : kamera sempat jalan tapi wajah tidak terdeteksi jelas
//     - (absen) : deteksi tidak sempat dicoba (model gagal dimuat, dll)
// }
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 });
    }
    const { mode, lat, lng, fotoPath = null, descriptor } = body;

    if (mode !== 'in' && mode !== 'out') {
      return NextResponse.json({ error: 'mode harus "in" atau "out".' }, { status: 400 });
    }
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { error: 'Lokasi tidak valid. Pastikan izin lokasi diaktifkan lalu coba lagi.' },
        { status: 400 }
      );
    }

    const session = await getSessionEmployee('id, status');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { emp } = session;

    const admin = createAdminClient();
    const now = new Date();
    const tanggal = todayJakarta(now);

    const ev = await evaluateClock(admin, { empId: emp.id, lat, lng, descriptor });
    const result = await saveClock(admin, {
      empId: emp.id,
      mode,
      now,
      tanggal,
      lat,
      lng,
      fotoPath,
      geo: toGeo(ev.geofence),
      wajah: ev.wajah,
      schedule: ev.schedule,
      scheduleError: ev.scheduleError,
    });

    if (result.fail) {
      return NextResponse.json({ error: result.fail.error }, { status: result.fail.status });
    }
    return NextResponse.json({ data: result.data });
  } catch (err) {
    console.error('Clock in/out error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat menyimpan absensi.' }, { status: 500 });
  }
}