// Preferensi "Lewati layar konfirmasi" absensi. Fungsi murni (tanpa Supabase).
//
// Dua level:
//   - default admin : app_settings.absensi_lewati_konfirmasi (boolean, berlaku untuk semua)
//   - override      : employees.lewati_konfirmasi_absensi  (null = ikut default admin,
//                     true/false = pilihan karyawan itu sendiri, MENIMPA default admin)
//
// Aturan aman: kalau apa pun tidak terbaca / tidak valid, layar konfirmasi TETAP
// ditampilkan (lewati = false). Melewati layar harus selalu pilihan eksplisit.

export const SETTING_KEY_LEWATI_KONFIRMASI = 'absensi_lewati_konfirmasi';

// Hanya boolean asli yang dianggap valid (jsonb true/false). Selain itu -> false.
export function parseBoolSetting(value) {
  return value === true;
}

// Override karyawan: true / false / null. Selain itu diperlakukan null (ikut default).
export function normalizeOverride(value) {
  return value === true || value === false ? value : null;
}

// sumber: 'karyawan' (override pribadi) | 'admin' (default admin)
export function resolveLewatiKonfirmasi({ adminDefault, override }) {
  const def = parseBoolSetting(adminDefault);
  const ov = normalizeOverride(override);
  if (ov !== null) return { lewati: ov, sumber: 'karyawan', adminDefault: def, override: ov };
  return { lewati: def, sumber: 'admin', adminDefault: def, override: null };
}