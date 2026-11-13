import { NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { FREELANCER_ADMIN_MODULE, FREELANCER_STATUS } from '@/lib/freelancerModules';
import { periksaFileUpload } from '@/lib/uploadServer';
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL } from '@/lib/uploadLimits';
import { FREELANCER_CV_MIME, FREELANCER_CV_LABEL_JENIS } from '@/lib/freelancerAdminConfig';

// SERVER ONLY — pembantu untuk route /api/freelancers/*.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function jsonError(error, status) {
  return NextResponse.json({ error }, { status });
}

// Gerbang semua route admin Freelancer: harus login sebagai karyawan Aktif dan
// punya modul `freelancer_admin` (superadmin otomatis lolos). Route memakai service
// role, jadi pengecekan ini WAJIB — RLS tidak berlaku di sini.
// Return { emp } atau { error, status }.
export async function gerbangFreelancerAdmin(admin) {
  return requireModuleAccess(admin, [FREELANCER_ADMIN_MODULE]);
}

// Email Freelancer harus unik lintas `employees` DAN `freelancers` (keputusan A1;
// trigger database juga menolak). Dicek lebih dulu supaya pesannya jelas dan
// undangan tidak terkirim percuma. Return string pesan error, atau null bila bebas.
export async function cekEmailBelumDipakai(admin, emailNorm) {
  const { data: fl, error: flError } = await admin
    .from('freelancers')
    .select('id')
    .eq('email', emailNorm)
    .limit(1);
  if (flError) throw flError;
  if ((fl || []).length > 0) return 'Email ini sudah terdaftar sebagai Freelancer.';

  // Karakter khusus LIKE di-escape supaya email dibandingkan apa adanya
  // (employees.email tidak dijamin huruf kecil seperti kolom freelancers).
  const pola = emailNorm.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const { data: emp, error: empError } = await admin
    .from('employees')
    .select('id')
    .ilike('email', pola)
    .limit(1);
  if (empError) throw empError;
  if ((emp || []).length > 0) {
    return 'Email ini sudah dipakai akun karyawan. Freelancer harus memakai email yang berbeda.';
  }
  return null;
}

// Samakan status Freelancer dengan Supabase Auth, seperti yang dilakukan untuk
// karyawan nonaktif (app/api/employee/[id]/route.js): akun inactive/suspended
// diblokir dari login baru dan perpanjangan sesi; active -> blokir dicabut.
// Access token yang sudah terbit tetap berlaku sampai kedaluwarsa (~1 jam), tetapi
// getSessionFreelancer/requireFreelancerModule menolak akun non-active di server,
// jadi API Freelancer tertutup seketika.
// Return 'banned' | 'unbanned' | 'tanpa_akun' | 'gagal'.
export async function sinkronBanFreelancer(admin, authUserId, status) {
  if (!authUserId) return 'tanpa_akun';
  const shouldBan = status !== FREELANCER_STATUS.ACTIVE;
  try {
    const { error } = await admin.auth.admin.updateUserById(authUserId, {
      ban_duration: shouldBan ? '876000h' : 'none',
    });
    if (error) {
      console.error('Sinkron ban Auth gagal untuk Freelancer', authUserId, error);
      return 'gagal';
    }
    return shouldBan ? 'banned' : 'unbanned';
  } catch (err) {
    console.error('Sinkron ban Auth error untuk Freelancer', authUserId, err);
    return 'gagal';
  }
}

// Peringatan untuk admin bila sinkron ban tidak berhasil/bukan hal yang dicari.
export function peringatanBan(hasil, status) {
  const shouldBan = status !== FREELANCER_STATUS.ACTIVE;
  if (hasil === 'gagal') {
    return shouldBan
      ? 'Status Freelancer sudah diubah, tetapi login-nya di Supabase Auth gagal diblokir. Freelancer ini mungkin masih bisa login (fitur dashboard tetap tertutup di server) — coba ulangi atau blokir manual dari Supabase Dashboard.'
      : 'Status Freelancer sudah diubah, tetapi blokir login-nya di Supabase Auth gagal dicabut. Freelancer ini mungkin belum bisa login — coba ulangi atau cabut blokir manual dari Supabase Dashboard.';
  }
  if (hasil === 'tanpa_akun') {
    return 'Status Freelancer sudah diubah, tetapi datanya belum terhubung ke akun login (auth_user_id kosong), jadi tidak ada login yang diblokir/dibuka.';
  }
  return null;
}

// Periksa file CV dari FormData. Return { error } atau { buffer, mime, ext }.
export async function periksaCv(file) {
  if (!file || typeof file === 'string') return { error: 'File CV wajib diupload.' };
  return periksaFileUpload(file, {
    mimeAllowed: FREELANCER_CV_MIME,
    maksBytes: UPLOAD_MAX_BYTES,
    labelJenis: FREELANCER_CV_LABEL_JENIS,
    labelUkuran: UPLOAD_MAX_LABEL,
    nama: 'CV',
  });
}
