// Konstanta & helper murni halaman Admin Payslip (app/employee/payslip/admin).
// Dipindah dari page.js supaya file halaman fokus ke state & tampilan.

export const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export function buildPeriodeLabel(tahun, bulan) {
  if (!tahun || !bulan) return '';
  const nama = MONTH_NAMES[Number(bulan) - 1];
  return nama ? `${nama} ${tahun}` : '';
}

export function previewNomorDokumen(lastNumber) {
  const tahun = new Date().getFullYear();
  const nomorPadded = String((lastNumber || 0) + 1).padStart(3, '0');
  return `INV/${tahun}/${nomorPadded}`;
}

// Distribusi pembulatan "largest remainder": memastikan total dari beberapa
// komponen yang dibulatkan SELALU sama dengan pembulatan dari total presisi
// (bukan sekadar menjumlah komponen yang sudah dibulatkan sendiri-sendiri,
// yang bisa selisih 1 rupiah). Komponen dengan sisa desimal terbesar yang
// "dinaikkan" duluan.
export function roundDistributed(values) {
  const keys = Object.keys(values);
  const floors = {};
  let flooredSum = 0;
  keys.forEach((k) => {
    floors[k] = Math.floor(values[k]);
    flooredSum += floors[k];
  });
  const rawSum = keys.reduce((sum, k) => sum + values[k], 0);
  const target = Math.round(rawSum);
  const remainder = target - flooredSum;
  const sortedByRemainder = [...keys].sort(
    (a, b) => (values[b] - floors[b]) - (values[a] - floors[a])
  );
  const result = { ...floors };
  for (let i = 0; i < remainder && i < sortedByRemainder.length; i++) {
    result[sortedByRemainder[i]] += 1;
  }
  return result;
}

export const PENDAPATAN_FIELDS = [
  { key: 'gaji_pokok', label: 'Gaji Pokok' },
  { key: 'lembur', label: 'Overtime (Lembur)' },
  { key: 'insentif', label: 'Incentive' },
  { key: 'kompensasi', label: 'Compensation Fund / Festive Allowance' },
  { key: 'tunjangan_lain', label: 'Allowance (Transport/Travel/Communication)' },
];

export const BPJS_PERUSAHAAN_FIELDS = [
  { key: 'jkk_perusahaan', label: 'JKK Perusahaan' },
  { key: 'jkm_perusahaan', label: 'JKM Perusahaan' },
  { key: 'jht_perusahaan', label: 'JHT Perusahaan' },
  { key: 'jp_perusahaan', label: 'JP Perusahaan' },
];

export const POTONGAN_FIELDS = [
  { key: 'jht_karyawan', label: 'JHT Karyawan' },
  { key: 'jp_karyawan', label: 'JP Karyawan' },
  { key: 'bpjs_k_karyawan', label: 'BPJS K Karyawan' },
  { key: 'pph21', label: 'PPh 21' },
  { key: 'penalty', label: 'Penalty (Keterlambatan)' },
];

export const NUMERIC_KEYS = [
  ...PENDAPATAN_FIELDS.map((f) => f.key),
  ...BPJS_PERUSAHAAN_FIELDS.map((f) => f.key),
  'bpjs_k_perusahaan',
  ...POTONGAN_FIELDS.map((f) => f.key),
];

export const EMPTY_FORM = {
  employee_id: '',
  periode: '',
  periode_label: '',
  nomor_dokumen: '',
  gaji_pokok: 0, lembur: 0, insentif: 0, kompensasi: 0, tunjangan_lain: 0,
  bpjs_k_perusahaan: 0,
  jkk_perusahaan: 0, jkm_perusahaan: 0, jht_perusahaan: 0, jp_perusahaan: 0,
  jht_karyawan: 0, jp_karyawan: 0, bpjs_k_karyawan: 0, pph21: 0, penalty: 0,
  rekening: '', metode_pembayaran: 'Transfer', tanggal_pembayaran: '',
  npwp: '', ptkp: '', no_bpjs_k: '', no_bpjs_tk: '',
  is_published: false,
};

export function formatRibuan(value) {
  const num = Number(value) || 0;
  return num === 0 ? '' : num.toLocaleString('id-ID');
}

export function calcTHP(p) {
  const totalPotongan = (p.penalty || 0) + (p.jht_karyawan || 0) + (p.jp_karyawan || 0) + (p.bpjs_k_karyawan || 0) + (p.pph21 || 0);
  return (p.gaji_pokok || 0) + (p.lembur || 0) + (p.insentif || 0) + (p.kompensasi || 0) + (p.tunjangan_lain || 0) - totalPotongan;
}

// Kolom yang bisa disortir — pola sama seperti app/employee/list.
export const SORT_COLUMNS = {
  nama: { get: (p) => (p.employees?.nama || '').toLowerCase() },
  periode: { get: (p) => p.periode || '' },
  nomor_dokumen: { get: (p) => (p.nomor_dokumen || '').toLowerCase() },
  thp: { get: (p) => calcTHP(p) },
  status: { get: (p) => (p.is_published ? 1 : 0) },
};
