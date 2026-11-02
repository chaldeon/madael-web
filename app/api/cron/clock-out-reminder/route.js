import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { runClockOutReminder, runClockOutReminderKemarin } from '@/lib/clockOutReminder';

export const dynamic = 'force-dynamic';

// GET/POST /api/cron/clock-out-reminder
//
// Dipicu penjadwal (BUKAN browser). Autentikasi: header
//   Authorization: Bearer <CRON_SECRET>
// Vercel Cron mengirim header ini otomatis bila env CRON_SECRET diisi; penjadwal
// lain (cron-job.org, GitHub Actions, pg_cron + pg_net) cukup menambahkannya.
// Tanpa CRON_SECRET di server, rute menolak semua permintaan (fail closed).
//
// Aman dipanggil berkali-kali dalam sehari: satu karyawan paling banyak
// menerima satu pengingat per hari (hari ini) dan satu pengingat untuk
// kemarin yang masih tanpa clock out. Rekomendasi jadwal: tiap 30 menit pada
// jam kerja sore WIB; pengingat kemarin ikut terkirim pada panggilan pertama
// setelah 07:00 WIB (lihat lib/clockOutReminder.js untuk aturan lengkap).

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
    const admin = createAdminClient();
    const summary = await runClockOutReminder(admin);
    // Kegagalan pengingat kemarin tidak boleh menutupi hasil pengingat hari ini.
    let kemarin;
    try {
      kemarin = await runClockOutReminderKemarin(admin);
    } catch (err) {
      console.error('Cron pengingat clock-out (kemarin) error:', err);
      kemarin = { error: true };
    }
    return NextResponse.json({ success: true, ...summary, kemarin });
  } catch (err) {
    console.error('Cron pengingat clock-out error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
