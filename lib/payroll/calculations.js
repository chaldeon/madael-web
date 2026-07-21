// Modul kalkulasi PPh21 (mode TER bulanan) & BPJS, diekstrak dari logic yang
// sama persis dengan app/kalkulator-pph21/page.js dan app/kalkulator-bpjs/page.js
// supaya tidak ada logic pajak/BPJS yang di-copy-paste ulang antara kalkulator
// publik dan Payroll Manager. Kalau ada perubahan tarif/PTKP di masa depan,
// cukup diubah di sini.

// ============ PPh21 — DATA PTKP & KATEGORI TER ============
export const PTKP_DATA = {
  TK0: { label: 'TK/0 — Belum Menikah', amount: 54000000, category: 'A' },
  TK1: { label: 'TK/1 — Belum Menikah, 1 Tanggungan', amount: 58500000, category: 'A' },
  TK2: { label: 'TK/2 — Belum Menikah, 2 Tanggungan', amount: 63000000, category: 'A' },
  TK3: { label: 'TK/3 — Belum Menikah, 3 Tanggungan', amount: 67500000, category: 'A' },
  K0: { label: 'K/0 — Menikah', amount: 58500000, category: 'B' },
  K1: { label: 'K/1 — Menikah, 1 Tanggungan', amount: 63000000, category: 'B' },
  K2: { label: 'K/2 — Menikah, 2 Tanggungan', amount: 67500000, category: 'B' },
  K3: { label: 'K/3 — Menikah, 3 Tanggungan', amount: 72000000, category: 'B' },
};

// ============ PPh21 — TABEL TER (resmi, PMK 168/2023 — Lampiran DJP) ============
const TER_A = [
  [5400000, 0], [5650000, 0.25], [5950000, 0.5], [6300000, 0.75], [6750000, 1],
  [7500000, 1.25], [8550000, 1.5], [9650000, 1.75], [10050000, 2], [10350000, 2.25],
  [10700000, 2.5], [11050000, 3], [11600000, 3.5], [12500000, 4], [13750000, 5],
  [15100000, 6], [16950000, 7], [19750000, 8], [24150000, 9], [26450000, 10],
  [28000000, 11], [30050000, 12], [32400000, 13], [35400000, 14], [39100000, 15],
  [43850000, 16], [47800000, 17], [51400000, 18], [56300000, 19], [62200000, 20],
  [68600000, 21], [77500000, 22], [89000000, 23], [103000000, 24], [125000000, 25],
  [157000000, 26], [206000000, 27], [337000000, 28], [454000000, 29], [550000000, 30],
  [695000000, 31], [910000000, 32], [1400000000, 33],
];

const TER_B = [
  [6200000, 0], [6500000, 0.25], [6850000, 0.5], [7300000, 0.75], [9200000, 1],
  [10750000, 1.5], [11250000, 2], [11600000, 2.5], [12600000, 3], [13600000, 4],
  [14950000, 5], [16400000, 6], [18450000, 7], [21850000, 8], [26000000, 9],
  [27700000, 10], [29350000, 11], [31450000, 12], [33950000, 13], [37100000, 14],
  [41100000, 15], [45800000, 16], [49500000, 17], [53800000, 18], [58500000, 19],
  [64000000, 20], [71000000, 21], [80000000, 22], [93000000, 23], [109000000, 24],
  [129000000, 25], [163000000, 26], [211000000, 27], [374000000, 28], [459000000, 29],
  [555000000, 30], [704000000, 31], [957000000, 32], [1405000000, 33],
];

function getTerRate(category, bruto) {
  const table = category === 'A' ? TER_A : TER_B;
  for (const [max, rate] of table) {
    if (bruto <= max) return rate;
  }
  return 34;
}

// Hitung PPh21 bulanan pakai metode TER — dipakai untuk payroll run bulanan
// (bukan mode "Tahunan"/final di kalkulator publik, karena Payroll Manager
// menghitung per periode berjalan, bukan rekonsiliasi akhir tahun).
// brutoBulanan: gaji_pokok + tunjangan + komponen_lain bulan ini.
// statusPtkp: salah satu key di PTKP_DATA (mis. 'TK0').
// npwpStatus: 'ada' | 'tidak' — TER sendiri tidak kena surcharge NPWP
// (surcharge 20% hanya berlaku di metode Pasal 17/tahunan), jadi npwpStatus
// disimpan di hasil untuk keperluan tampilan/pelaporan saja.
export function hitungPPh21TER(brutoBulanan, statusPtkp) {
  const ptkp = PTKP_DATA[statusPtkp];
  if (!ptkp) return null;
  const rate = getTerRate(ptkp.category, brutoBulanan);
  const pph = brutoBulanan * (rate / 100);
  return { bruto: brutoBulanan, category: ptkp.category, rate, pph };
}

// ============ BPJS ============
export const CAP_KESEHATAN = 12000000;
export const CAP_JP = 9559600;

export const JKK_OPTIONS = [
  { value: 0.0024, label: 'Sangat Rendah (0.24%)' },
  { value: 0.0054, label: 'Rendah (0.54%)' },
  { value: 0.0089, label: 'Sedang (0.89%)' },
  { value: 0.0127, label: 'Tinggi (1.27%)' },
  { value: 0.0174, label: 'Sangat Tinggi (1.74%)' },
];

// totalGaji: basis iuran BPJS di Madael = Gaji Pokok saja (Gross Salary),
// TIDAK termasuk tunjangan/komponen lain.
// jkkRate: salah satu value di JKK_OPTIONS.
export function hitungBPJS(totalGaji, jkkRate) {
  const basisKesehatan = Math.min(totalGaji, CAP_KESEHATAN);
  const basisJP = Math.min(totalGaji, CAP_JP);

  const kesehatanEmployer = basisKesehatan * 0.04;
  const kesehatanEmployee = basisKesehatan * 0.01;
  const jkk = totalGaji * (jkkRate || 0);
  const jkm = totalGaji * 0.003;
  const jhtEmployer = totalGaji * 0.037;
  const jhtEmployee = totalGaji * 0.02;
  const jpEmployer = basisJP * 0.02;
  const jpEmployee = basisJP * 0.01;

  const totalEmployer = kesehatanEmployer + jkk + jkm + jhtEmployer + jpEmployer;
  const totalEmployee = kesehatanEmployee + jhtEmployee + jpEmployee;

  return {
    kesehatanEmployer, kesehatanEmployee, jkk, jkm,
    jhtEmployer, jhtEmployee, jpEmployer, jpEmployee,
    totalEmployer, totalEmployee, grandTotal: totalEmployer + totalEmployee,
  };
}

// ============ Bruto PPh21 ============
// Sesuai skema Madael: BPJS Kesehatan, JKK, dan JKM yang ditanggung
// perusahaan dihitung sebagai kenikmatan (benefit-in-kind) kena PPh21
// (PMK 66/2023) — JHT & JP employer TIDAK dihitung (itu tabungan pensiun,
// bukan kenikmatan kena pajak).
// gajiPokok: Gross Salary (basis BPJS).
// allowance: tunjangan + komponen lain (di luar gaji pokok).
// bpjs: hasil hitungBPJS(gajiPokok, jkkRate) — employer-nya dipakai di sini.
// penalty: potongan (mis. telat/tidak hadir) — default 0, TBD sumber datanya.
export function hitungBrutoPPh21(gajiPokok, allowance, bpjs, penalty = 0) {
  return gajiPokok + allowance + bpjs.kesehatanEmployer + bpjs.jkk + bpjs.jkm - (penalty || 0);
}

// ============ Penalty — Keterlambatan ============
// Potongan keterlambatan Madael: total menit telat dalam sebulan < 30 menit
// tidak kena potongan; >= 30 menit kena Rp3.000 per menit di atas 30 menit
// (tidak ada batas atas tier lain per konfirmasi).
export function hitungPenaltyTelat(totalMenitTelat) {
  if (!totalMenitTelat || totalMenitTelat < 30) return 0;
  return (totalMenitTelat - 30) * 3000;
}