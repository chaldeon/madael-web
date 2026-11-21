// Rute dan kesiapan halaman Tool BPA1 di sisi UI (BPA-05).
//
// Tujuan file ini: daftar BPA1 tidak boleh menampilkan tautan ke halaman yang
// BELUM ada (tautan ke halaman kosong/404). Tiap halaman tujuan punya bendera
// kesiapan; tautan baru muncul setelah task yang membuat halamannya mengubah
// bendera itu menjadi true — cukup satu baris di file ini:
//
//   HALAMAN_BUAT_BPA1_ADA   -> true sejak BPA-07 (form Buat BPA1)
//   HALAMAN_DETAIL_BPA1_ADA -> ubah ke true di BPA-19 (hasil/detail BPA1)
//
// Query form Buat (`?client_id=&tahun=`, keduanya opsional) dibaca oleh
// app/employee/payroll/bpa1/buat/page.js (BPA-07); daftar membaca `?tahun=`.
// ASUMSI: bentuk rute Detail (`/employee/payroll/bpa1/<document_id>`) masih
// USULAN; halamannya belum ada dan BPA-19 yang menetapkan rute sebenarnya,
// lalu menyesuaikan hrefDetailBpa1 bila berbeda.

export const RUTE_DAFTAR_BPA1 = '/employee/payroll/bpa1';
export const RUTE_BUAT_BPA1 = `${RUTE_DAFTAR_BPA1}/buat`;

export const HALAMAN_BUAT_BPA1_ADA = true; // BPA-07: app/employee/payroll/bpa1/buat/page.js
export const HALAMAN_DETAIL_BPA1_ADA = false;

// clientId opsional: tanpa klien, form Buat terbuka dengan pilihan klien kosong.
export function hrefBuatBpa1(clientId, tahun) {
  const params = new URLSearchParams();
  if (clientId) params.set('client_id', String(clientId));
  if (tahun) params.set('tahun', String(tahun));
  const query = params.toString();
  return query ? `${RUTE_BUAT_BPA1}?${query}` : RUTE_BUAT_BPA1;
}

// Daftar kembali dengan tahun pajak tertentu terpilih (mis. setelah Buat).
export function hrefDaftarBpa1(tahun) {
  return tahun ? `${RUTE_DAFTAR_BPA1}?tahun=${encodeURIComponent(String(tahun))}` : RUTE_DAFTAR_BPA1;
}

// Pilihan tahun pajak di daftar dan form Buat: 5 tahun ke belakang sampai 1
// tahun ke depan dari tahun berjalan (WIB), terbaru dulu. Batas 2000–2100
// tetap dijaga server.
const TAHUN_KE_BELAKANG = 5;
const TAHUN_KE_DEPAN = 1;

export function daftarTahunPilihan(tahunIni) {
  const awal = tahunIni - TAHUN_KE_BELAKANG;
  const akhir = tahunIni + TAHUN_KE_DEPAN;
  return Array.from({ length: akhir - awal + 1 }, (_, i) => akhir - i);
}

// Tahun dari query string (?tahun=) hanya dipakai bila termasuk pilihan;
// selain itu `cadangan`.
export function tahunDariQuery(raw, pilihan, cadangan) {
  const n = typeof raw === 'string' && /^\d{4}$/.test(raw) ? Number(raw) : NaN;
  return pilihan.includes(n) ? n : cadangan;
}

export function hrefDetailBpa1(documentId) {
  return `${RUTE_DAFTAR_BPA1}/${encodeURIComponent(String(documentId))}`;
}
