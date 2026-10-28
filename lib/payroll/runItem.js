// Hitung ulang satu item Payroll Run setelah Overtime/Insentif/Kompensasi diisi.
// Murni (tanpa akses DB) supaya bisa dipakai API route dan diuji terpisah.
//
// Rumus SAMA PERSIS dengan yang dulu ada di browser (halaman detail run):
//   Bruto PPh21 = Gaji Pokok + Allowance + Overtime + Insentif + Kompensasi
//               + JKK + JKM + BPJS Kesehatan (perusahaan) − Penalty
// Gaji pokok, allowance, dan penalty diambil dari snapshot item (nilai saat
// run dibuat); JKK dan PTKP dari master karyawan saat ini.

import { hitungBPJS, hitungBrutoPPh21, hitungPPh21TER } from './calculations';

// Batas wajar per komponen per karyawan per bulan (Rp). Mencegah salah ketik
// (mis. kelebihan nol) dan nilai tak terhingga/NaN masuk ke payroll.
export const MAKS_NOMINAL_MANUAL = 10_000_000_000;

// Validasi satu input nominal manual. Kosong/undefined dianggap 0 (sama seperti
// perilaku lama). Return { value } atau { error }.
export function bacaNominalManual(raw, label) {
  if (raw === undefined || raw === null || raw === '') return { value: 0 };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return { error: `${label} harus berupa angka.` };
  if (n < 0) return { error: `${label} tidak boleh negatif.` };
  if (n > MAKS_NOMINAL_MANUAL) return { error: `${label} terlalu besar.` };
  return { value: n };
}

// item  : baris payroll_run_items (gaji_pokok, allowance, penalty)
// master: baris employees_master terkait (jkk_rate, status_ptkp) — boleh null
// manual: { overtime, insentif, kompensasi } sudah divalidasi
// Return payload kolom yang disimpan ke payroll_run_items.
export function hitungUlangItem(item, master, manual) {
  const overtime = Number(manual.overtime) || 0;
  const insentif = Number(manual.insentif) || 0;
  const kompensasi = Number(manual.kompensasi) || 0;

  const gajiPokok = Number(item.gaji_pokok) || 0;
  const totalForBruto = (Number(item.allowance) || 0) + overtime + insentif + kompensasi;
  const bpjs = master?.jkk_rate != null ? hitungBPJS(gajiPokok, master.jkk_rate) : null;
  const brutoPPh21 = bpjs ? hitungBrutoPPh21(gajiPokok, totalForBruto, bpjs, item.penalty) : null;
  const pph21Result = (bpjs && master?.status_ptkp) ? hitungPPh21TER(brutoPPh21, master.status_ptkp) : null;
  const pph21 = pph21Result ? Math.floor(pph21Result.pph) : 0;
  const bpjsEmployee = bpjs ? bpjs.totalEmployee : 0;
  const takeHomePay = gajiPokok + totalForBruto - (Number(item.penalty) || 0) - bpjsEmployee - pph21;

  return {
    overtime,
    insentif,
    kompensasi,
    pph21,
    take_home_pay: Math.round(takeHomePay),
  };
}
