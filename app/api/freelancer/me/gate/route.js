import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireFreelancerModule, muatSyaratGate } from '@/lib/freelancerAccessServer';
import { jsonError } from '@/lib/freelancerAdminServer';
import { ringkasGalat } from '@/lib/freelancerProfile';
import { PESAN_GATE_GAGAL } from '@/lib/freelancerGate';

// GET /api/freelancer/me/gate — apakah syarat akses (profil lengkap + Agreement
// terverifikasi) sudah terpenuhi, dan apa yang masih kurang. Baca-saja, untuk UI
// (dashboard/tab) agar modul gated bisa tampil tertutup dengan penjelasan. UI
// HANYA tampilan: penegakan sebenarnya ada di requireFreelancerModule pada setiap
// route modul gated.
//
// Pengaman: id Freelancer dari sesi; akun karyawan dan Freelancer non-active
// ditolak di gerbang (403). Memakai modul `freelancer_profile` (tidak gated) supaya
// Freelancer yang belum memenuhi syarat tetap bisa melihat apa yang kurang. Respons
// hanya berisi indikator (nama kolom yang kosong, status Agreement), tidak pernah
// nilai data pembayaran. Gagal memeriksa -> 503 (UI memperlakukannya sebagai tertutup).
export async function GET() {
  try {
    const admin = createAdminClient();
    const akses = await requireFreelancerModule(admin, ['freelancer_profile']);
    if (akses.error) return jsonError(akses.error, akses.status);

    let gate;
    try {
      gate = await muatSyaratGate(admin, akses.freelancer.id);
    } catch (err) {
      console.error('GET /api/freelancer/me/gate gagal memeriksa syarat:', ringkasGalat(err));
      return jsonError(PESAN_GATE_GAGAL, 503);
    }

    return NextResponse.json({ gate }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('GET /api/freelancer/me/gate error:', ringkasGalat(err));
    return jsonError('Terjadi kesalahan server.', 500);
  }
}
