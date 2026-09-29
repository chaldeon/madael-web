import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { todayJakarta } from '@/lib/serverTime';
import { evaluateClock, saveClock, toGeo } from '@/lib/attendanceClock';
import { resolveFotoRef } from '@/lib/attendanceFotoRef';

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
//   qr: string | undefined
//     - kalau ada, absen dilakukan via QR lokasi (fotoPath & descriptor diabaikan)
// }
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 });
    }
    const { mode, lat, lng, descriptor } = body;
    const qr = typeof body.qr === 'string' && body.qr ? body.qr : null;
    const fotoRaw = qr ? null : (body.fotoPath ?? null);

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

    // Sebelumnya route ini menyimpan fotoPath apa adanya. Sekarang divalidasi sama
    // seperti /confirm: hanya referensi foto bertanda tangan milik karyawan ini.
    const foto = resolveFotoRef(fotoRaw, emp.id);
    if (!foto.ok) {
      return NextResponse.json({ error: 'Referensi foto tidak valid.' }, { status: 400 });
    }
    const fotoPath = foto.value;

    const admin = createAdminClient();
    const now = new Date();
    const tanggal = todayJakarta(now);

    const ev = await evaluateClock(admin, { empId: emp.id, lat, lng, descriptor, qr });
    if (ev.fail) {
      return NextResponse.json({ error: ev.fail.error }, { status: ev.fail.status });
    }
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
      metode: ev.metode,
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