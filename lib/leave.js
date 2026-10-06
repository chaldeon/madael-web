// Helper hitung hari kerja untuk modul Leave Request. Sabtu/Minggu atau
// hari yang tidak ada di work_schedule.hari_kerja employee TIDAK dihitung
// sebagai hari cuti. Pola HARI_LABEL sama seperti di
// app/employee/absensi/rekap/page.js — dijaga konsisten di satu tempat.

export const HARI_LABEL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// Dipakai kalau employee belum punya row work_schedule sama sekali —
// konsisten dengan DEFAULT_HARI di app/employee/absensi/karyawan/page.js.
export const DEFAULT_HARI_KERJA = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];

// Jenis pengajuan. Hanya jenis dengan potongKuota=true yang mengurangi jatah
// cuti tahunan di employees_master; sakit/izin tetap dicatat & diberi lampiran
// tapi tidak menyentuh kuota. lampiranWajibMinHari: lampiran wajib kalau jumlah
// hari kerja >= angka ini (null = lampiran selalu opsional). Ubah di sini kalau
// kebijakan perusahaan berbeda — API dan form membaca konfigurasi yang sama.
export const JENIS_CUTI = {
  tahunan: { label: 'Cuti Tahunan', potongKuota: true, lampiranWajibMinHari: null },
  sakit: { label: 'Sakit', potongKuota: false, lampiranWajibMinHari: 2 },
  izin: { label: 'Izin', potongKuota: false, lampiranWajibMinHari: null },
};
export const JENIS_CUTI_DEFAULT = 'tahunan';
export const JENIS_POTONG_KUOTA = Object.keys(JENIS_CUTI).filter((k) => JENIS_CUTI[k].potongKuota);

export function jenisCutiValid(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(JENIS_CUTI, value);
}

// Baris lama / nilai tak dikenal diperlakukan sebagai cuti tahunan.
export function labelJenisCuti(value) {
  return (JENIS_CUTI[value] || JENIS_CUTI[JENIS_CUTI_DEFAULT]).label;
}

export function potongKuota(value) {
  return (JENIS_CUTI[value] || JENIS_CUTI[JENIS_CUTI_DEFAULT]).potongKuota;
}

export function lampiranWajib(jenis, jumlahHari) {
  const min = (JENIS_CUTI[jenis] || JENIS_CUTI[JENIS_CUTI_DEFAULT]).lampiranWajibMinHari;
  return min !== null && jumlahHari >= min;
}

// Memproses (setujui/tolak) pengajuan milik sendiri ditolak untuk semua orang,
// termasuk superadmin, supaya selalu ada mata kedua. Ubah ke true kalau
// superadmin memang satu-satunya approver di perusahaan.
export const SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN = false;

// Lampiran: dibatasi 4MB karena request ke route Vercel maksimal 4,5MB.
export const LAMPIRAN_MAKS_BYTES = 4 * 1024 * 1024;
export const LAMPIRAN_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

// Tahun kalender saat ini menurut WIB. Server (Vercel) berjalan di UTC, jadi
// new Date().getFullYear() bisa meleset sehari di sekitar 1 Januari.
export function tahunSekarang() {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric' }).format(new Date()));
}

// Validasi string tanggal 'YYYY-MM-DD' (format DAN tanggalnya benar-benar ada).
export function tanggalValid(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function tahunDariTanggal(value) {
  return Number(String(value).slice(0, 4));
}

// Hitung jumlah hari cuti (inklusif tanggalMulai & tanggalSelesai) yang
// jatuh di hari kerja employee saja.
export function hitungHariKerja(tanggalMulai, tanggalSelesai, hariKerja) {
  if (!tanggalMulai || !tanggalSelesai) return 0;
  const hari = hariKerja?.length ? hariKerja : DEFAULT_HARI_KERJA;
  const mulai = new Date(tanggalMulai + 'T00:00:00');
  const selesai = new Date(tanggalSelesai + 'T00:00:00');
  if (selesai < mulai) return 0;

  let count = 0;
  const cursor = new Date(mulai);
  while (cursor <= selesai) {
    if (hari.includes(HARI_LABEL[cursor.getDay()])) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

// Sisa kuota tahun berjalan dari satu row employees_master, dengan lazy
// reset: kalau cuti_terpakai_tahun bukan tahun ini, counter dianggap 0
// (tidak perlu cron job reset tiap 1 Januari).
export function hitungSisaCuti(master, currentYear = tahunSekarang()) {
  if (!master) return null;
  const jatah = master.jatah_cuti_tahunan ?? 12;
  const terpakai = master.cuti_terpakai_tahun === currentYear ? (master.cuti_terpakai || 0) : 0;
  return { jatah, terpakai, sisa: Math.max(0, jatah - terpakai), tahun: currentYear };
}