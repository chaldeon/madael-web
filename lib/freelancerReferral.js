// Kode referral Freelancer (FRE-TOOL-09).
//
// Kode dibuat ACAK dan TERPISAH dari Freelancer ID (FL-0001): nomor FL bisa dipakai
// ulang di masa depan, sedangkan kode referral harus unik dan tidak bisa ditebak dari
// urutan akun. Keunikan dijaga indeks UNIQUE `freelancers_referral_code_key`.
//
// File ini aman dipakai di browser maupun server (hanya memakai Web Crypto global,
// tanpa import Node). Tidak ada fitur regenerasi atau edit kode (FRE-Q-03).

// 31 karakter: tanpa 0/O, 1/I/L yang mudah tertukar. Jangan ubah isinya setelah ada
// kode yang beredar tanpa memeriksa kode lama (kode lama tidak akan lolos validasi).
export const REFERRAL_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const REFERRAL_CODE_LENGTH = 8; // 31^8 ≈ 8,5 × 10^11 kemungkinan
export const REFERRAL_MAX_ATTEMPTS = 5;
export const REFERRAL_QUERY_PARAM = 'ref';

const codeRe = new RegExp(`^[${REFERRAL_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);

// Kode acak yang aman secara kriptografis. Byte dengan nilai >= 248 dibuang
// (248 = 31 × 8) supaya setiap karakter punya peluang sama (tanpa modulo bias).
export function generateReferralCode() {
  const limit = 256 - (256 % REFERRAL_ALPHABET.length);
  let code = '';
  while (code.length < REFERRAL_CODE_LENGTH) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(REFERRAL_CODE_LENGTH * 2));
    for (const b of bytes) {
      if (b < limit && code.length < REFERRAL_CODE_LENGTH) {
        code += REFERRAL_ALPHABET[b % REFERRAL_ALPHABET.length];
      }
    }
  }
  return code;
}

// Format kode yang dihasilkan generateReferralCode (huruf besar). Pemanggil yang
// menerima ketikan manual wajib mengubahnya ke huruf besar lebih dulu.
export function isValidReferralCodeFormat(code) {
  return typeof code === 'string' && codeRe.test(code);
}

// Bentrok UNIQUE (SQLSTATE 23505) pada kode referral. Dicek lewat nama
// constraint/kolom di pesan supaya bentrok FL-ID atau email TIDAK dianggap bentrok
// kode referral (dan sebaliknya: isFreelancerCodeConflict di lib/freelancerId.js
// tidak mencocokkan "referral_code").
export function isReferralCodeConflict(error) {
  if (!error || String(error.code) !== '23505') return false;
  const text = `${error.message || ''} ${error.details || ''}`;
  return /referral_code/i.test(text);
}

// Link bagikan: {origin}/karir/{slug}?ref={kode}. Format link = rekomendasi; yang
// diputuskan (18 Nov 2026) adalah mekanismenya: ?ref= mengisi kolom kode di form.
// `origin` kosong -> link relatif ("/karir/..."). Dipakai bersama FRE-TOOL-10.
// Return '' bila slug atau kode kosong.
export function buildReferralLink({ slug, code, origin = '' } = {}) {
  const s = typeof slug === 'string' ? slug.trim() : '';
  const c = typeof code === 'string' ? code.trim() : '';
  if (!s || !c) return '';
  const base = String(origin || '').replace(/\/+$/, '');
  return `${base}/karir/${encodeURIComponent(s)}?${REFERRAL_QUERY_PARAM}=${encodeURIComponent(c)}`;
}
