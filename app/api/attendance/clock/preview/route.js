import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { todayJakarta } from '@/lib/serverTime';
import {
  evaluateClock, precheckClock, calcStatusTelat, toGeo, buildPreview,
} from '@/lib/attendanceClock';
import { signConfirmToken } from '@/lib/attendanceConfirmToken';

// POST /api/attendance/clock/preview
// Langkah 1 dari alur "layar review + konfirmasi": menghitung SEMUA hasil di
// server (jam, telat, geofence, skor wajah) persis seperti /api/attendance/clock,
// tapi TIDAK menyimpan apa pun. Mengembalikan ringkasan read-only untuk layar
// review + token bertanda tangan yang dipakai /api/attendance/clock/confirm.
//
// Di luar radius / wajah tidak cocok TIDAK memblokir — cuma muncul sebagai
// peringatan di layar review; kasusnya tetap ditangkap tab "Perlu Review" admin
// setelah disimpan, sama seperti jalur simpan langsung.
//
// body: { mode: 'in' | 'out', lat, lng, descriptor, qr? }  (tanpa fotoPath: foto baru
// diupload saat konfirmasi, jadi karyawan yang membatalkan tidak meninggalkan file).
// `qr` (teks hasil scan) -> absen via QR: tidak ada foto/wajah, lokasi mengikuti QR.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 });
    }
    const { mode, lat, lng, descriptor } = body;
    const qr = typeof body.qr === 'string' && body.qr ? body.qr : null;

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

    const ev = await evaluateClock(admin, { empId: emp.id, lat, lng, descriptor, qr });
    if (ev.fail) {
      return NextResponse.json({ error: ev.fail.error }, { status: ev.fail.status });
    }

    // Gagal lebih awal kalau pasti tidak bisa disimpan (sudah absen, belum absen
    // masuk, dst), supaya karyawan tidak diajak mengonfirmasi sesuatu yang gagal.
    const pre = await precheckClock(admin, { empId: emp.id, mode, tanggal });
    if (pre.fail) {
      return NextResponse.json({ error: pre.fail.error }, { status: pre.fail.status });
    }
    // Sama seperti saat simpan: jadwal gagal dibaca -> jangan tampilkan status telat yang salah.
    if (mode === 'in' && ev.scheduleError) throw ev.scheduleError;

    const geo = toGeo(ev.geofence);
    const statusTelat = mode === 'in' ? calcStatusTelat(ev.schedule, now) : null;

    const { token, expiresAt } = signConfirmToken({
      emp: emp.id,
      mode,
      t: now.getTime(),
      metode: ev.metode,
      tanggal,
      lat,
      lng,
      geo,
      wajah: { ok: ev.wajah.ok, distance: ev.wajah.distance },
    });

    return NextResponse.json({
      token,
      expiresAt,
      preview: buildPreview({
        mode,
        now,
        tanggal,
        schedule: ev.schedule,
        statusTelat,
        geofence: ev.geofence,
        wajah: ev.wajah,
        lat,
        lng,
        clockInAt: mode === 'out' ? pre.todayRow?.clock_in || null : null,
        metode: ev.metode,
      }),
    });
  } catch (err) {
    console.error('Clock preview error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat menyiapkan ringkasan absensi.' }, { status: 500 });
  }
}