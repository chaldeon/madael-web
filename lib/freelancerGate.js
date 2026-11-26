import { AGREEMENT_STATUS, AGREEMENT_STATUS_LABEL } from '@/lib/freelancerAgreementConfig';
import { PROFILE_PAYMENT_LABEL } from '@/lib/freelancerProfile';

// Gate akses Freelancer (FRE-TOOL-07): modul bertanda `gated` di registry baru terbuka
// bila profil lengkap DAN Agreement berstatus `terverifikasi` (walaupun dokumen sudah
// diunggah Tim). Ini SATU-SATUNYA tempat aturan syarat tersebut; server
// (requireFreelancerModule), route GET /api/freelancer/me/gate, dan UI (banner Profil
// Saya, dashboard) memakai fungsi yang sama.
//
// File ini aman dipakai di browser (tidak mengimpor modul khusus-server). Aturan
// kelengkapan profil sendiri tetap di lib/freelancerProfile.js (dihitung di sana,
// hasilnya dimasukkan ke sini sebagai `profil_lengkap`/`kolom_kosong`).
//
// Masukan dan keluaran memakai nama kunci yang sama (snake_case seperti API lain),
// jadi hasil evaluasi dapat diteruskan apa adanya ke browser:
//   profil_lengkap   : true hanya bila profil lengkap (selain true = belum lengkap)
//   kolom_kosong     : nama kolom wajib yang kosong (tidak pernah nilainya)
//   agreement_status : nilai AGREEMENT_STATUS; kosong/null = belum tersedia
// Keluaran: { terpenuhi, profil_lengkap, kolom_kosong, agreement_status,
//             kurang: ['profil'?, 'agreement'?], pesan }  (pesan null bila terpenuhi)
// Masukan yang tidak jelas dianggap BELUM terpenuhi (gagal aman).
export function evaluasiGate({ profil_lengkap, kolom_kosong, agreement_status } = {}) {
  const status = agreement_status || AGREEMENT_STATUS.BELUM_TERSEDIA;
  const profilOk = profil_lengkap === true;
  const agreementOk = status === AGREEMENT_STATUS.TERVERIFIKASI;
  const kosong = profilOk ? [] : Array.isArray(kolom_kosong) ? kolom_kosong : [];

  const kurang = [];
  const bagian = [];
  if (!profilOk) {
    kurang.push('profil');
    const labels = kosong.map((key) => PROFILE_PAYMENT_LABEL[key] || key);
    bagian.push(labels.length ? `profil belum lengkap (belum diisi: ${labels.join(', ')})` : 'profil belum lengkap');
  }
  if (!agreementOk) {
    kurang.push('agreement');
    const label = (AGREEMENT_STATUS_LABEL[status] || status).toLowerCase();
    bagian.push(`Agreement belum terverifikasi (status: ${label})`);
  }

  const terpenuhi = kurang.length === 0;
  return {
    terpenuhi,
    profil_lengkap: profilOk,
    kolom_kosong: kosong,
    agreement_status: status,
    kurang,
    pesan: terpenuhi
      ? null
      : `Fitur ini baru terbuka setelah profil lengkap dan Agreement terverifikasi. Yang masih kurang: ${bagian.join('; ')}. Lengkapi di Profil Saya.`,
  };
}

// Pesan bila syarat tidak dapat diperiksa (query gagal). Modul gated tetap TERTUTUP.
export const PESAN_GATE_GAGAL = 'Syarat akses belum dapat diperiksa saat ini. Coba lagi beberapa saat.';
