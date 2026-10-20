// Single source of truth untuk "apa itu data karyawan yang lengkap".
// Dipakai oleh app/employee/list/page.js (badge per baris) dan
// app/employee/data-audit/page.js (Seksi 3), supaya definisi "field penting
// yang kosong" tidak dobel-didefinisikan dan bisa beda sendiri-sendiri.
//
// CATATAN: alamat & kontak_darurat baru ada sejak modul Profil Saya
// (app/employee/profile) ditambahkan — karyawan sendiri yang paling sering
// mengisi ini lewat pengajuan perubahan, bukan admin lewat Payroll Manager.

// Predikat yang dipakai bersama sisi admin (missingImportantFields) dan sisi
// karyawan (missingFieldsForEmployee) supaya definisi "rekening/kontak darurat
// terisi" tidak bisa berbeda di dua tempat.
const hasRekening = (m) => !!(m.nama_rekening && m.no_rekening);
const hasKontakDarurat = (m) => !!(m.kontak_darurat_nama && m.kontak_darurat_telepon);

export function missingImportantFields(master) {
  const missing = [];
  if (!master) return missing; // ketiadaan master row ditangani terpisah, bukan lewat daftar ini
  if (!master.status_ptkp) missing.push('Status PTKP');
  if (!master.npwp_status) missing.push('Status NPWP');
  if (master.jkk_rate === null || master.jkk_rate === undefined || master.jkk_rate === '') missing.push('Tingkat Risiko JKK');
  if (!hasRekening(master)) missing.push('Rekening (nama/nomor)');
  if (!master.alamat) missing.push('Alamat');
  if (!hasKontakDarurat(master)) missing.push('Kontak Darurat');
  return missing;
}

// Turunan untuk sisi karyawan (banner di Profil Saya + titik di kartu dashboard).
// Hanya field yang BISA diisi karyawan sendiri lewat Profil Saya
// (lihat PROFILE_EDITABLE_FIELDS di lib/profileFields.js): rekening, NPWP,
// alamat, kontak darurat, nomor BPJS. SENGAJA tidak termasuk Status PTKP dan
// Tingkat Risiko JKK — itu hanya bisa diisi HR/superadmin lewat Payroll Manager,
// jadi menampilkannya ke karyawan cuma membuat daftar yang tak bisa mereka tindak.
//
// Beda tipis dengan sisi admin: untuk NPWP, status "Tidak Ada NPWP" dianggap
// lengkap, sedangkan status "Ada NPWP" tanpa nomor dianggap belum lengkap.
// Nomor BPJS belum dihitung di badge admin (missingImportantFields).
//
// Mengembalikan array label (string), kosong bila lengkap atau master null.
export function missingFieldsForEmployee(master) {
  const missing = [];
  if (!master) return missing;
  if (!hasRekening(master)) missing.push('Rekening (nama/nomor)');
  if (!master.npwp_status) missing.push('Status NPWP');
  else if (master.npwp_status === 'ada' && !master.npwp) missing.push('Nomor NPWP');
  if (!master.alamat) missing.push('Alamat');
  if (!hasKontakDarurat(master)) missing.push('Kontak Darurat');
  if (!master.no_bpjs_kesehatan) missing.push('Nomor BPJS Kesehatan');
  if (!master.no_bpjs_ketenagakerjaan) missing.push('Nomor BPJS Ketenagakerjaan');
  return missing;
}

// Kolom employees_master yang dibutuhkan missingFieldsForEmployee — dipakai
// dashboard supaya select-nya tidak menarik kolom lain dan tidak tertinggal
// kalau definisi di atas bertambah.
export const EMPLOYEE_COMPLETENESS_COLUMNS =
  'id, nama_rekening, no_rekening, npwp_status, npwp, alamat, kontak_darurat_nama, kontak_darurat_telepon, no_bpjs_kesehatan, no_bpjs_ketenagakerjaan';

// level: 'critical' (belum ada data HR sama sekali) | 'warning' (ada tapi
// belum lengkap, atau jadwal kerja belum diatur) | 'complete'
export function getCompletenessInfo({ master, hasSchedule }) {
  if (!master) {
    return { level: 'critical', missing: [], label: 'Belum ada data HR' };
  }
  const missing = missingImportantFields(master);
  if (!hasSchedule) missing.push('Jadwal Kerja');
  if (missing.length === 0) {
    return { level: 'complete', missing: [], label: 'Lengkap' };
  }
  return { level: 'warning', missing, label: `${missing.length} field kosong` };
}