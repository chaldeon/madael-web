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

// Kolom employees_master yang boleh dikirim ke halaman Profil Saya lewat
// GET /api/profile/me. SENGAJA tanpa gaji_pokok/tunjangan (halaman itu tidak
// menampilkannya) dan tanpa kolom payroll lain: pemilik data hanya menerima
// data identitas/rekening/NPWP/BPJS miliknya sendiri plus posisi & status.
export const PROFILE_MASTER_COLUMNS = [
  'id',
  'posisi',
  'status',
  ...PROFILE_EDITABLE_FIELDS.map((f) => f.key),
].join(', ');

export function fieldLabel(key) {
  return PROFILE_EDITABLE_FIELDS.find((f) => f.key === key)?.label || key;
}

// Whitelist key yang boleh diterapkan ke employees_master saat pengajuan
// disetujui. field_changes dikirim karyawan langsung dari browser (JSON bebas),
// jadi route approval (app/api/profile-change-requests/[id]/decision) dan UI
// review sama-sama memakai ini — jangan menerapkan key di luar daftar ini.
export const PROFILE_EDITABLE_KEYS = new Set(PROFILE_EDITABLE_FIELDS.map((f) => f.key));

export function isAllowedProfileField(key) {
  return PROFILE_EDITABLE_KEYS.has(key);
}

// ── Validasi nilai pengajuan (POST /api/profile-change-requests) ──────────
export const MAKS_PANJANG_ALAMAT = 500;
export const MAKS_PANJANG_FIELD_PROFIL = 150;
export const MAKS_CATATAN_KARYAWAN_PROFIL = 500;

// Validasi + normalisasi satu nilai `after`. Return { value } (string atau
// null = dikosongkan) atau { error }. Aturan panjang & opsi select sama dengan
// yang ditegakkan saat approve (app/api/profile-change-requests/[id]/decision),
// supaya pengajuan yang lolos di sini juga lolos di sana.
export function bersihkanNilaiProfil(key, after) {
  if (after !== null && typeof after !== 'string') {
    return { error: `Nilai "${fieldLabel(key)}" tidak valid.` };
  }
  const nilai = after === null ? null : after.trim() || null;
  if (nilai === null) return { value: null };

  const maks = key === 'alamat' ? MAKS_PANJANG_ALAMAT : MAKS_PANJANG_FIELD_PROFIL;
  if (nilai.length > maks) {
    return { error: `"${fieldLabel(key)}" maksimal ${maks} karakter.` };
  }

  // Field select (mis. npwp_status): hanya nilai yang ada di opsi form.
  // Opsi '' berarti "belum diisi", sudah dinormalisasi jadi null di atas.
  const options = PROFILE_EDITABLE_FIELDS.find((f) => f.key === key)?.options;
  if (options && !options.some((o) => o.value === nilai)) {
    return { error: `Nilai "${fieldLabel(key)}" tidak termasuk pilihan yang diizinkan.` };
  }
  return { value: nilai };
}
