// Single source of truth untuk field employees_master yang boleh diajukan
// perubahannya sendiri oleh karyawan lewat Profil Saya (app/employee/profile).
//
// SENGAJA TIDAK termasuk di sini: posisi, status, gaji_pokok, tunjangan,
// komponen_lain, jkk_rate, jatah_cuti_tahunan, cuti_terpakai — field-field
// itu tetap read-only dan hanya bisa diubah superadmin lewat Payroll Manager
// (app/employee/payroll), bukan lewat approval Profil Saya ini.
//
// Dipakai oleh app/employee/profile/page.js (form pengajuan) dan
// app/employee/profile/admin/page.js (tampilan review before/after) supaya
// label & urutan field selalu konsisten di kedua tempat.
export const PROFILE_EDITABLE_FIELDS = [
  { key: 'alamat', label: 'Alamat', type: 'textarea' },
  { key: 'kontak_darurat_nama', label: 'Nama Kontak Darurat', type: 'text' },
  { key: 'kontak_darurat_hubungan', label: 'Hubungan', type: 'text', placeholder: 'Suami/Istri, Orang Tua, dll' },
  { key: 'kontak_darurat_telepon', label: 'Telepon Kontak Darurat', type: 'text' },
  { key: 'nama_rekening', label: 'Nama Pemilik Rekening', type: 'text' },
  { key: 'no_rekening', label: 'No Rekening', type: 'text' },
  {
    key: 'npwp_status',
    label: 'Status NPWP',
    type: 'select',
    options: [
      { value: '', label: '— Belum diisi —' },
      { value: 'ada', label: 'Ada NPWP' },
      { value: 'tidak', label: 'Tidak Ada NPWP' },
    ],
  },
  { key: 'npwp', label: 'Nomor NPWP', type: 'text' },
  { key: 'no_bpjs_kesehatan', label: 'Nomor BPJS Kesehatan', type: 'text' },
  { key: 'no_bpjs_ketenagakerjaan', label: 'Nomor BPJS Ketenagakerjaan', type: 'text' },
];

export function fieldLabel(key) {
  return PROFILE_EDITABLE_FIELDS.find((f) => f.key === key)?.label || key;
}
