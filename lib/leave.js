// Helper hitung hari kerja untuk modul Leave Request. Sabtu/Minggu atau
// hari yang tidak ada di work_schedule.hari_kerja employee TIDAK dihitung
// sebagai hari cuti. Pola HARI_LABEL sama seperti di
// app/employee/absensi/rekap/page.js — dijaga konsisten di satu tempat.

export const HARI_LABEL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// Dipakai kalau employee belum punya row work_schedule sama sekali —
// konsisten dengan DEFAULT_HARI di app/employee/absensi/jadwal/page.js.
export const DEFAULT_HARI_KERJA = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];

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
export function hitungSisaCuti(master, currentYear = new Date().getFullYear()) {
  if (!master) return null;
  const jatah = master.jatah_cuti_tahunan ?? 12;
  const terpakai = master.cuti_terpakai_tahun === currentYear ? (master.cuti_terpakai || 0) : 0;
  return { jatah, terpakai, sisa: Math.max(0, jatah - terpakai), tahun: currentYear };
}