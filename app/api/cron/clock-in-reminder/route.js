import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { runClockInReminder } from '@/lib/clockInReminder';

export const dynamic = 'force-dynamic';

// GET/POST /api/cron/clock-in-reminder
//
// Dipicu penjadwal (BUKAN browser). Autentikasi: header
//   Authorization: Bearer <CRON_SECRET>
// Sama dengan /api/cron/clock-out-reminder: Vercel Cron mengirim header ini
// otomatis bila env CRON_SECRET diisi; penjadwal lain (cron-job.org, GitHub
// Actions, pg_cron + pg_net) cukup menambahkannya. Tanpa CRON_SECRET di server,
// rute menolak semua permintaan (fail closed).
//
// Aman dipanggil berkali-kali dalam sehari: satu karyawan paling banyak
// menerima satu pengingat per tanggal. Rekomendasi jadwal: tiap 15-30 menit
// pada pagi hari kerja WIB (mis. 07:00-11:00 WIB; Vercel Cron memakai UTC, jadi
// "*/15 0-4 * * 1-6"). Panggilan di luar jendela jam masuk tidak mengirim apa
// pun (lihat lib/clockInReminder.js untuk aturan lengkap).

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, status: 503, error: 'CRON_SECRET belum dikonfigurasi.' };

  const header = request.headers.get('authorization') || '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, status: 401, error: 'Tidak diizinkan.' };
  }
  return { ok: true };
}

async function handle(request) {
  const auth = authorized(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const summary = await runClockInReminder(createAdminClient());
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error('Cron pengingat clock-in error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
