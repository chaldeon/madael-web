'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import CalculatorDevWarning from '@/components/CalculatorDevWarning';

// ============ DATA PTKP & KATEGORI TER ============
const PTKP_DATA = {
  TK0: { labelId: 'TK/0 — Belum Menikah', labelEn: 'TK/0 — Single, No Dependents', amount: 54000000, category: 'A' },
  TK1: { labelId: 'TK/1 — Belum Menikah, 1 Tanggungan', labelEn: 'TK/1 — Single, 1 Dependent', amount: 58500000, category: 'A' },
  TK2: { labelId: 'TK/2 — Belum Menikah, 2 Tanggungan', labelEn: 'TK/2 — Single, 2 Dependents', amount: 63000000, category: 'A' },
  TK3: { labelId: 'TK/3 — Belum Menikah, 3 Tanggungan', labelEn: 'TK/3 — Single, 3 Dependents', amount: 67500000, category: 'A' },
  K0: { labelId: 'K/0 — Menikah', labelEn: 'K/0 — Married, No Dependents', amount: 58500000, category: 'B' },
  K1: { labelId: 'K/1 — Menikah, 1 Tanggungan', labelEn: 'K/1 — Married, 1 Dependent', amount: 63000000, category: 'B' },
  K2: { labelId: 'K/2 — Menikah, 2 Tanggungan', labelEn: 'K/2 — Married, 2 Dependents', amount: 67500000, category: 'B' },
  K3: { labelId: 'K/3 — Menikah, 3 Tanggungan', labelEn: 'K/3 — Married, 3 Dependents', amount: 72000000, category: 'B' },
};

// ============ TABEL TER (resmi, PMK 168/2023 — Lampiran DJP) ============
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

// ============ TARIF PROGRESIF PASAL 17 ============
const BRACKETS_17 = [
  [60000000, 5],
  [250000000, 15],
  [500000000, 25],
  [5000000000, 30],
  [Infinity, 35],
];

function hitungPasal17(pkp) {
  if (pkp <= 0) return 0;
  let sisa = pkp;
  let pajak = 0;
  let batasBawah = 0;
  for (const [batasAtas, tarif] of BRACKETS_17) {
    const lapisan = Math.min(sisa, batasAtas - batasBawah);
    if (lapisan <= 0) break;
    pajak += lapisan * (tarif / 100);
    sisa -= lapisan;
    batasBawah = batasAtas;
    if (sisa <= 0) break;
  }
  return pajak;
}

function formatRupiah(num) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(num || 0);
}

function formatNumberDisplay(value, lang) {
  if (value === '' || value === null || value === undefined) return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  return num.toLocaleString(lang === 'id' ? 'id-ID' : 'en-US');
}

// ============ TERJEMAHAN ============
const translations = {
  id: {
    eyebrow: 'Tool Gratis',
    title: 'Kalkulator PPh 21',
    subtitle: 'Simulasikan potongan PPh 21 bulanan (TER) atau akhir tahun (progresif Pasal 17) sesuai PMK 168/2023.',
    modeTer: 'PPh Masa (TER)',
    modeTahunan: 'PPh Akhir Tahun',
    dataPenghasilan: 'Data Penghasilan',
    hasilPerhitungan: 'Hasil Perhitungan',
    statusPtkp: 'Status PTKP',
    tunjPPh: 'Tunjangan PPh / Bulan',
    tunjLain: 'Tunjangan Lain / Bulan',
    gajiPokokBulan: 'Gaji Pokok / Bulan',
    hitung: 'Hitung',
    reset: 'Reset',
    emptyState: 'Isi data di kiri lalu klik Hitung untuk melihat hasilnya.',
    brutoBulan: 'Penghasilan Bruto / Bulan',
    kategoriTer: 'Kategori TER',
    tarifTer: 'Tarif TER',
    pphBulanIni: 'PPh 21 Terutang Bulan Ini',
    brutoSetahun: 'Total Bruto Diterima',
    biayaJabatan: 'Biaya Jabatan',
    ptkpRow: 'PTKP',
    pkpRow: 'Penghasilan Kena Pajak (PKP)',
    pphSetahun: 'PPh 21 Terutang',
    pphPerBulan: 'PPh 21 Rata-rata / Bulan',
    catatanMasaKerja: (n) => `* Dihitung untuk masa perolehan penghasilan: ${n} bulan.`,
    catatanNpwp: '* Termasuk tambahan 20% karena tidak memiliki NPWP.',
    ctaTitle: 'Butuh payroll yang lebih akurat dan bebas ribet?',
    ctaDesc: 'Madael Consult membantu perusahaan mengelola payroll dan kepatuhan PPh 21 secara profesional.',
    ctaButton: 'Hubungi Madael Consult',
    terFields: {
      gajiPensiun: { label: 'Gaji/Pensiun atau THT/JHT', tip: 'Gaji pokok bulanan, uang pensiun bulanan, atau penarikan dana THT/JHT. Ini komponen dasar penghasilan bruto.' },
      tunjPPh: { label: 'Tunjangan PPh', tip: 'Tunjangan yang diberikan perusahaan untuk menanggung PPh 21 karyawan (skema gross-up). Tunjangan ini juga menjadi objek pajak.' },
      tunjLainLembur: { label: 'Tunjangan Lainnya, Uang Lembur, dan sebagainya', tip: 'Tunjangan tetap/tidak tetap lain (transport, makan, komunikasi) dan upah lembur yang dibayarkan rutin bersama gaji.' },
      honorarium: { label: 'Honorarium dan Imbalan Lainnya Sejenisnya', tip: 'Honorarium, komisi, atau imbalan sejenis di luar gaji rutin yang diterima pegawai tetap pada bulan berjalan.' },
      premiAsuransi: { label: 'Premi Asuransi yang dibayar Pemberi Kerja', tip: 'Premi asuransi kesehatan, kecelakaan, jiwa, dwiguna, atau beasiswa yang dibayar/ditanggung perusahaan. Sesuai PMK 168/2023, ini termasuk objek PPh 21.' },
      naturaKenikmatan: { label: 'Natura dan Kenikmatan Lainnya', tip: 'Fasilitas dalam bentuk barang/kenikmatan (mobil dinas, rumah dinas, dll). Sejak PMK 66/2023, sebagian natura menjadi objek pajak berdasarkan nilai wajarnya.' },
      bonusTHR: { label: 'Tantiem, Bonus, Gratifikasi, Jasa Produksi dan THR', tip: 'Penghasilan tidak teratur yang diterima sekali/beberapa kali setahun (THR, bonus, tantiem, jasa produksi). Digabung ke bruto bulan diterimanya.' },
      brutoOtomatis: { label: 'Penghasilan Bruto', tip: 'Total seluruh komponen di atas. Nilai ini otomatis dipakai untuk mencari tarif TER sesuai kategori dan lapisan penghasilan.' },
    },
    tahunanFields: {
      npwpStatus: { label: 'Status NPWP', tip: 'Karyawan tanpa NPWP dikenakan tarif PPh 21 20% lebih tinggi dari tarif normal, sesuai Pasal 21 UU PPh.' },
      masaPerolehan: { label: 'Masa Perolehan Penghasilan', tip: 'Jumlah bulan penghasilan diterima dalam setahun. Untuk karyawan yang tidak bekerja setahun penuh, biaya jabatan dan hasil dihitung proporsional sesuai jumlah bulan ini.' },
      penghasilanTidakTeratur: { label: 'Penghasilan Tidak Teratur (Bonus/THR)', tip: 'Penghasilan yang diterima tidak rutin setiap bulan, seperti bonus, THR, atau tantiem. Dimasukkan terpisah dari penghasilan teratur (gaji bulanan).' },
      iuranPensiun: { label: 'Iuran Pensiun / JHT Dibayar Sendiri', tip: 'Iuran pensiun (misal DPLK) atau JHT yang dibayar sendiri oleh karyawan, bukan dipotong otomatis oleh BPJS/perusahaan. Nilai ini mengurangi Penghasilan Kena Pajak (PKP).' },
    },
    npwpOptions: { ada: 'Punya NPWP', tidak: 'Tidak Punya NPWP' },
  },
  en: {
    eyebrow: 'Free Tool',
    title: 'PPh 21 Tax Calculator',
    subtitle: "Estimate your monthly (TER) or year-end (progressive) PPh 21 income tax withholding under Indonesia's PMK 168/2023.",
    modeTer: 'Monthly (TER)',
    modeTahunan: 'Year-End',
    dataPenghasilan: 'Income Details',
    hasilPerhitungan: 'Calculation Result',
    statusPtkp: 'PTKP Status (Tax-Free Income Bracket)',
    tunjPPh: 'Tax Allowance / Month',
    tunjLain: 'Other Allowances / Month',
    gajiPokokBulan: 'Basic Salary / Month',
    hitung: 'Calculate',
    reset: 'Reset',
    emptyState: 'Fill in the details on the left, then click Calculate to see your result.',
    brutoBulan: 'Gross Income / Month',
    kategoriTer: 'TER Category',
    tarifTer: 'TER Rate',
    pphBulanIni: 'PPh 21 Due This Month',
    brutoSetahun: 'Total Gross Received',
    biayaJabatan: 'Biaya Jabatan (occupational deduction)',
    ptkpRow: 'PTKP (non-taxable income)',
    pkpRow: 'PKP (taxable income)',
    pphSetahun: 'PPh 21 Due',
    pphPerBulan: 'Average PPh 21 / Month',
    catatanMasaKerja: (n) => `* Calculated for ${n} month(s) of income.`,
    catatanNpwp: '* Includes 20% surcharge for not having an NPWP (Tax ID).',
    ctaTitle: "Want payroll that's accurate and hassle-free?",
    ctaDesc: 'Madael Consult helps companies manage payroll and PPh 21 compliance professionally.',
    ctaButton: 'Contact Madael Consult',
    terFields: {
      gajiPensiun: { label: 'Gaji/Pensiun atau THT/JHT (Salary/Pension or Old-Age Savings)', tip: 'Monthly base salary, monthly pension, or THT/JHT (old-age savings) withdrawal. The core component of gross income.' },
      tunjPPh: { label: 'Tunjangan PPh (Tax Allowance)', tip: "Allowance paid by the employer to cover the employee's PPh 21 (gross-up scheme). This allowance is itself taxable." },
      tunjLainLembur: { label: 'Tunjangan Lainnya, Uang Lembur, dsb (Other Allowances & Overtime)', tip: 'Other fixed/variable allowances (transport, meals, communication) and overtime pay received regularly with salary.' },
      honorarium: { label: 'Honorarium dan Imbalan Lainnya Sejenisnya (Honoraria & Similar Payments)', tip: 'Honoraria, commissions, or similar payments received by a permanent employee outside their regular salary this month.' },
      premiAsuransi: { label: 'Premi Asuransi yang dibayar Pemberi Kerja (Employer-Paid Insurance Premiums)', tip: 'Health, accident, life, endowment, or scholarship insurance premiums paid by the employer. Under PMK 168/2023, these are taxable.' },
      naturaKenikmatan: { label: 'Natura dan Kenikmatan Lainnya (Benefits-in-Kind)', tip: 'Benefits-in-kind (company car, company housing, etc). Since PMK 66/2023, some benefits-in-kind are taxed at fair value.' },
      bonusTHR: { label: 'Tantiem, Bonus, Gratifikasi, Jasa Produksi dan THR (Bonuses & THR)', tip: 'Irregular income received once or a few times a year (THR, bonus, tantiem, production services). Added to gross income for the month received.' },
      brutoOtomatis: { label: 'Penghasilan Bruto (Gross Income)', tip: 'Sum of all components above. Automatically used to find the applicable TER rate based on category and income bracket.' },
    },
    tahunanFields: {
      npwpStatus: { label: 'Status NPWP (Tax ID Status)', tip: 'Employees without an NPWP (Indonesian Tax ID) are subject to a PPh 21 rate 20% higher than normal, per Article 21 of the Income Tax Law.' },
      masaPerolehan: { label: 'Masa Perolehan Penghasilan (Months Worked)', tip: "Number of months income was earned within the year. For employees who didn't work the full year, occupational costs and results are prorated to this number of months." },
      penghasilanTidakTeratur: { label: 'Penghasilan Tidak Teratur / Irregular Income (Bonus/THR)', tip: 'Income received irregularly, such as bonus, THR, or tantiem — entered separately from regular monthly salary.' },
      iuranPensiun: { label: 'Iuran Pensiun / JHT Dibayar Sendiri (Self-Paid Pension/JHT)', tip: 'Pension contributions (e.g. DPLK) or JHT paid directly by the employee, not automatically deducted via BPJS/employer. This reduces taxable income (PKP).' },
    },
    npwpOptions: { ada: 'Has NPWP', tidak: 'No NPWP' },
  },
};

const initialTerInputs = {
  status: 'TK0',
  gajiPensiun: '',
  tunjPPh: '',
  tunjLainLembur: '',
  honorarium: '',
  premiAsuransi: '',
  naturaKenikmatan: '',
  bonusTHR: '',
};

const initialTahunanInputs = {
  status: 'TK0',
  npwpStatus: 'ada',
  masaPerolehan: '12',
  gaji: '',
  tunjPPh: '',
  tunjLain: '',
  penghasilanTidakTeratur: '',
  iuranPensiun: '',
};

// ============ TOOLTIP ============
function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="w-4 h-4 rounded-full border border-[#B0B0B0] text-[#6B6B6B] text-[10px] leading-none flex items-center justify-center hover:border-madael-red hover:text-madael-red transition-colors flex-shrink-0"
        aria-label="Info"
      >
        i
      </button>
      {open && (
        <span className="absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 bg-white border border-[#E0E0E0] text-[#3D3D3D] text-xs leading-relaxed rounded-md px-3 py-2.5 shadow-lg normal-case font-normal">
          {text}
        </span>
      )}
    </span>
  );
}

function FieldLabel({ label, tooltip }) {
  return (
    <label className="flex items-center gap-1.5 text-xs tracking-[0.02em] text-[#6B6B6B] mb-2">
      <span>{label}</span>
      <InfoTooltip text={tooltip} />
    </label>
  );
}

export default function KalkulatorPPh21() {
  const { lang } = useLanguage();
  const t = translations[lang];

  const [mode, setMode] = useState('ter');
  const [terInputs, setTerInputs] = useState(initialTerInputs);
  const [tahunanInputs, setTahunanInputs] = useState(initialTahunanInputs);
  const [result, setResult] = useState(null);

  const handleTerNumberChange = (field) => (e) => {
    const raw = e.target.value.replace(/[^\d]/g, '');
    setTerInputs((prev) => ({ ...prev, [field]: raw }));
  };
  const handleTahunanNumberChange = (field) => (e) => {
    const raw = e.target.value.replace(/[^\d]/g, '');
    setTahunanInputs((prev) => ({ ...prev, [field]: raw }));
  };

  const terBruto =
    (Number(terInputs.gajiPensiun) || 0) +
    (Number(terInputs.tunjPPh) || 0) +
    (Number(terInputs.tunjLainLembur) || 0) +
    (Number(terInputs.honorarium) || 0) +
    (Number(terInputs.premiAsuransi) || 0) +
    (Number(terInputs.naturaKenikmatan) || 0) +
    (Number(terInputs.bonusTHR) || 0);

  const handleReset = () => {
    if (mode === 'ter') setTerInputs(initialTerInputs);
    else setTahunanInputs(initialTahunanInputs);
    setResult(null);
  };

  const handleHitung = () => {
    if (mode === 'ter') {
      const ptkp = PTKP_DATA[terInputs.status];
      const rate = getTerRate(ptkp.category, terBruto);
      const pph = terBruto * (rate / 100);
      setResult({ mode: 'ter', bruto: terBruto, category: ptkp.category, rate, pph });
    } else {
      const gaji = Number(tahunanInputs.gaji) || 0;
      const tunjPPh = Number(tahunanInputs.tunjPPh) || 0;
      const tunjLain = Number(tahunanInputs.tunjLain) || 0;
      const penghasilanTidakTeratur = Number(tahunanInputs.penghasilanTidakTeratur) || 0;
      const iuranPensiun = Number(tahunanInputs.iuranPensiun) || 0;
      const masaKerja = Number(tahunanInputs.masaPerolehan) || 12;
      const ptkp = PTKP_DATA[tahunanInputs.status];

      const brutoBulanan = gaji + tunjPPh + tunjLain;
      const brutoDiterima = brutoBulanan * masaKerja + penghasilanTidakTeratur;
      const capBiayaJabatan = 500000 * masaKerja;
      const biayaJabatan = Math.min(brutoDiterima * 0.05, capBiayaJabatan);
      const netoDiterima = brutoDiterima - biayaJabatan - iuranPensiun;
      const pkpRaw = netoDiterima - ptkp.amount;
      const pkp = Math.max(Math.floor(pkpRaw / 1000) * 1000, 0);

      let pphSetahun = hitungPasal17(pkp);
      const npwpSurcharge = tahunanInputs.npwpStatus === 'tidak';
      if (npwpSurcharge) pphSetahun *= 1.2;

      const pphPerBulan = pphSetahun / masaKerja;

      setResult({
        mode: 'tahunan',
        brutoSetahun: brutoDiterima,
        biayaJabatan,
        ptkp: ptkp.amount,
        pkp,
        pphSetahun,
        pphPerBulan,
        masaKerja,
        npwpSurcharge,
      });
    }
  };

  const inputClass =
    'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black focus:outline-none focus:border-madael-red transition-colors';
  const plainLabelClass = 'block text-xs tracking-[0.02em] text-[#6B6B6B] mb-2';

  return (
    <>
      <section className="bg-black px-10 py-16 border-b-4 border-madael-red">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-[11px] uppercase tracking-[0.18em] text-madael-red font-semibold mb-4">
            {t.eyebrow}
          </div>
          <h1 className="font-serif text-[36px] font-normal text-white tracking-[-0.02em] leading-[1.2] mb-3">
            {t.title}
          </h1>
          <p className="text-[#AAA] text-sm max-w-[480px]">{t.subtitle}</p>
        </div>
      </section>

      <CalculatorDevWarning />

      <section className="px-10 pt-10 bg-white">
        <div className="max-w-[1100px] mx-auto flex gap-2">
          <button
            onClick={() => { setMode('ter'); setResult(null); }}
            className={`px-6 py-2.5 text-sm font-medium tracking-[0.02em] transition-colors ${
              mode === 'ter' ? 'bg-madael-red text-white' : 'bg-[#F4F4F4] text-[#6B6B6B] hover:bg-[#E0E0E0]'
            }`}
          >
            {t.modeTer}
          </button>
          <button
            onClick={() => { setMode('tahunan'); setResult(null); }}
            className={`px-6 py-2.5 text-sm font-medium tracking-[0.02em] transition-colors ${
              mode === 'tahunan' ? 'bg-madael-red text-white' : 'bg-[#F4F4F4] text-[#6B6B6B] hover:bg-[#E0E0E0]'
            }`}
          >
            {t.modeTahunan}
          </button>
        </div>
      </section>

      <section className="px-10 py-10 bg-white">
        <div className="max-w-[1100px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-12">

          {/* ============ INPUT ============ */}
          <div>
            <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] mb-6 border-l-[3px] border-madael-red pl-4">
              {t.dataPenghasilan}
            </h2>

            {mode === 'ter' ? (
              <>
                <div className="mb-5">
                  <label className={plainLabelClass}>{t.statusPtkp}</label>
                  <select
                    value={terInputs.status}
                    onChange={(e) => setTerInputs((p) => ({ ...p, status: e.target.value }))}
                    className={inputClass}
                  >
                    {Object.entries(PTKP_DATA).map(([key, val]) => (
                      <option key={key} value={key}>{lang === 'id' ? val.labelId : val.labelEn}</option>
                    ))}
                  </select>
                </div>

                {['gajiPensiun', 'tunjPPh', 'tunjLainLembur', 'honorarium', 'premiAsuransi', 'naturaKenikmatan', 'bonusTHR'].map((field) => (
                  <div className="mb-5" key={field}>
                    <FieldLabel label={t.terFields[field].label} tooltip={t.terFields[field].tip} />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatNumberDisplay(terInputs[field], lang)}
                      onChange={handleTerNumberChange(field)}
                      className={inputClass}
                      placeholder="0"
                    />
                  </div>
                ))}

                <div className="mb-8 border border-[#E0E0E0] bg-[#F9F9F9] px-4 py-3 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs tracking-[0.02em] text-[#6B6B6B]">
                    {t.terFields.brutoOtomatis.label}
                    <InfoTooltip text={t.terFields.brutoOtomatis.tip} />
                  </span>
                  <span className="text-sm font-semibold text-black">{formatRupiah(terBruto)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="mb-5">
                  <label className={plainLabelClass}>{t.statusPtkp}</label>
                  <select
                    value={tahunanInputs.status}
                    onChange={(e) => setTahunanInputs((p) => ({ ...p, status: e.target.value }))}
                    className={inputClass}
                  >
                    {Object.entries(PTKP_DATA).map(([key, val]) => (
                      <option key={key} value={key}>{lang === 'id' ? val.labelId : val.labelEn}</option>
                    ))}
                  </select>
                </div>

                <div className="mb-5">
                  <FieldLabel label={t.tahunanFields.npwpStatus.label} tooltip={t.tahunanFields.npwpStatus.tip} />
                  <select
                    value={tahunanInputs.npwpStatus}
                    onChange={(e) => setTahunanInputs((p) => ({ ...p, npwpStatus: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="ada">{t.npwpOptions.ada}</option>
                    <option value="tidak">{t.npwpOptions.tidak}</option>
                  </select>
                </div>

                <div className="mb-5">
                  <FieldLabel label={t.tahunanFields.masaPerolehan.label} tooltip={t.tahunanFields.masaPerolehan.tip} />
                  <select
                    value={tahunanInputs.masaPerolehan}
                    onChange={(e) => setTahunanInputs((p) => ({ ...p, masaPerolehan: e.target.value }))}
                    className={inputClass}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n} {lang === 'id' ? 'bulan' : 'month(s)'}</option>
                    ))}
                  </select>
                </div>

                <div className="mb-5">
                  <label className={plainLabelClass}>{t.gajiPokokBulan}</label>
                  <input type="text" inputMode="numeric" value={formatNumberDisplay(tahunanInputs.gaji, lang)} onChange={handleTahunanNumberChange('gaji')} className={inputClass} placeholder="0" />
                </div>

                <div className="mb-5">
                  <label className={plainLabelClass}>{t.tunjPPh}</label>
                  <input type="text" inputMode="numeric" value={formatNumberDisplay(tahunanInputs.tunjPPh, lang)} onChange={handleTahunanNumberChange('tunjPPh')} className={inputClass} placeholder="0" />
                </div>

                <div className="mb-5">
                  <label className={plainLabelClass}>{t.tunjLain}</label>
                  <input type="text" inputMode="numeric" value={formatNumberDisplay(tahunanInputs.tunjLain, lang)} onChange={handleTahunanNumberChange('tunjLain')} className={inputClass} placeholder="0" />
                </div>

                <div className="mb-5">
                  <FieldLabel label={t.tahunanFields.penghasilanTidakTeratur.label} tooltip={t.tahunanFields.penghasilanTidakTeratur.tip} />
                  <input type="text" inputMode="numeric" value={formatNumberDisplay(tahunanInputs.penghasilanTidakTeratur, lang)} onChange={handleTahunanNumberChange('penghasilanTidakTeratur')} className={inputClass} placeholder="0" />
                </div>

                <div className="mb-8">
                  <FieldLabel label={t.tahunanFields.iuranPensiun.label} tooltip={t.tahunanFields.iuranPensiun.tip} />
                  <input type="text" inputMode="numeric" value={formatNumberDisplay(tahunanInputs.iuranPensiun, lang)} onChange={handleTahunanNumberChange('iuranPensiun')} className={inputClass} placeholder="0" />
                </div>
              </>
            )}

            <div className="flex gap-3">
              <button onClick={handleHitung} className="bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors">
                {t.hitung}
              </button>
              <button onClick={handleReset} className="border border-[#E0E0E0] text-[#6B6B6B] px-8 py-3 text-sm font-medium tracking-[0.04em] hover:border-madael-red hover:text-madael-red transition-colors">
                {t.reset}
              </button>
            </div>
          </div>

          {/* ============ OUTPUT ============ */}
          <div>
            <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] mb-6 border-l-[3px] border-madael-red pl-4">
              {t.hasilPerhitungan}
            </h2>

            {!result && (
              <div className="border border-dashed border-[#E0E0E0] p-10 text-center text-sm text-[#6B6B6B]">
                {t.emptyState}
              </div>
            )}

            {result && result.mode === 'ter' && (
              <div className="border border-[#E0E0E0]">
                <Row label={t.brutoBulan} value={formatRupiah(result.bruto)} />
                <Row label={t.kategoriTer} value={`${lang === 'id' ? 'Kategori' : 'Category'} ${result.category}`} />
                <Row label={t.tarifTer} value={`${result.rate}%`} />
                <Row label={t.pphBulanIni} value={formatRupiah(result.pph)} highlight />
              </div>
            )}

            {result && result.mode === 'tahunan' && (
              <>
                <div className="border border-[#E0E0E0]">
                  <Row label={t.brutoSetahun} value={formatRupiah(result.brutoSetahun)} />
                  <Row label={t.biayaJabatan} value={formatRupiah(result.biayaJabatan)} />
                  <Row label={t.ptkpRow} value={formatRupiah(result.ptkp)} />
                  <Row label={t.pkpRow} value={formatRupiah(result.pkp)} />
                  <Row label={t.pphSetahun} value={formatRupiah(result.pphSetahun)} />
                  <Row label={t.pphPerBulan} value={formatRupiah(result.pphPerBulan)} highlight />
                </div>
                {(result.masaKerja !== 12 || result.npwpSurcharge) && (
                  <div className="mt-3 text-xs text-[#6B6B6B] space-y-1">
                    {result.masaKerja !== 12 && <p>{t.catatanMasaKerja(result.masaKerja)}</p>}
                    {result.npwpSurcharge && <p>{t.catatanNpwp}</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <section className="px-10 py-16 bg-[#F4F4F4] border-t border-[#E0E0E0] text-center">
        <h3 className="font-serif text-[24px] font-normal text-black tracking-[-0.02em] mb-3">{t.ctaTitle}</h3>
        <p className="text-sm text-[#6B6B6B] mb-6 max-w-[480px] mx-auto">{t.ctaDesc}</p>
        <a href="https://wa.me/6285121548247?text=Halo%20Madael%20Consult%2C%20saya%20ingin%20konsultasi%20mengenai%20layanan%20payroll%20Anda." target="_blank" rel="noopener noreferrer" className="inline-block bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors">
          {t.ctaButton}
        </a>
      </section>
    </>
  );
}

function Row({ label, value, highlight }) {
  return (
    <div className={`flex justify-between items-center px-6 py-4 border-b border-[#E0E0E0] last:border-b-0 gap-4 ${highlight ? 'bg-madael-red' : 'bg-white'}`}>
      <span className={`text-xs tracking-[0.02em] ${highlight ? 'text-white/80' : 'text-[#6B6B6B]'}`}>{label}</span>
      <span className={`text-sm font-semibold text-right ${highlight ? 'text-white text-base' : 'text-black'}`}>{value}</span>
    </div>
  );
}
