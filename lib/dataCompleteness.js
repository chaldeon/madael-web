// Single source of truth untuk "apa itu data karyawan yang lengkap".
// Dipakai oleh app/employee/list/page.js (badge per baris) dan
// app/employee/data-audit/page.js (Seksi 3), supaya definisi "field penting
// yang kosong" tidak dobel-didefinisikan dan bisa beda sendiri-sendiri.
//
// CATATAN: alamat & kontak_darurat baru ada sejak modul Profil Saya
// (app/employee/profile) ditambahkan — karyawan sendiri yang paling sering
// mengisi ini lewat pengajuan perubahan, bukan admin lewat Payroll Manager.
export function missingImportantFields(master) {
  const missing = [];
  if (!master) return missing; // ketiadaan master row ditangani terpisah, bukan lewat daftar ini
  if (!master.status_ptkp) missing.push('Status PTKP');
  if (!master.npwp_status) missing.push('Status NPWP');
  if (master.jkk_rate === null || master.jkk_rate === undefined || master.jkk_rate === '') missing.push('Tingkat Risiko JKK');
  if (!master.nama_rekening || !master.no_rekening) missing.push('Rekening (nama/nomor)');
  if (!master.alamat) missing.push('Alamat');
  if (!master.kontak_darurat_nama || !master.kontak_darurat_telepon) missing.push('Kontak Darurat');
  return missing;
}

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