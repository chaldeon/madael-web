// Formatter tampilan yang dipakai lintas halaman — satu sumber supaya format
// Rupiah di seluruh portal karyawan konsisten.

// Nilai kosong/null dianggap 0 → "Rp 0". Untuk angka yang selalu ada
// (gaji, THP, total).
export function formatRupiah(value) {
  return 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
}

// Untuk field opsional: null/undefined/'' tampil "-" (bukan "Rp 0"), sedangkan
// 0 yang memang terisi tetap tampil "Rp 0".
export function formatRupiahOrDash(value) {
  if (value === null || value === undefined || value === '') return '-';
  return 'Rp ' + Math.round(value).toLocaleString('id-ID');
}
