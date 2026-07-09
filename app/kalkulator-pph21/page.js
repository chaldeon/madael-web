'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

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
    gajiPokok: 'Gaji Pokok / Bulan',
    tunjPPh: 'Tunjangan PPh / Bulan',
    tunjLain: 'Tunjangan Lain / Bulan',
    bonus: mode => (mode === 'ter' ? 'Bonus / THR (Bulan Ini)' : 'Bonus / THR (Setahun)'),
    hitung: 'Hitung',
    reset: 'Reset',
    emptyState: 'Isi data di kiri lalu klik Hitung untuk melihat hasilnya.',
    brutoBulan: 'Penghasilan Bruto / Bulan',
    kategoriTer: 'Kategori TER',
    tarifTer: 'Tarif TER',
    pphBulanIni: 'PPh 21 Terutang Bulan Ini',
    brutoSetahun: 'Bruto Setahun',
    biayaJabatan: 'Biaya Jabatan (maks. Rp6jt/th)',
    ptkpRow: 'PTKP',
    pkpRow: 'Penghasilan Kena Pajak (PKP)',
    pphSetahun: 'PPh 21 Setahun',
    pphPerBulan: 'PPh 21 per Bulan',
    ctaTitle: 'Butuh payroll yang lebih akurat dan bebas ribet?',
    ctaDesc: 'Madael Consult membantu perusahaan mengelola payroll dan kepatuhan PPh 21 secara profesional.',
    ctaButton: 'Hubungi Madael Consult',
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
    gajiPokok: 'Basic Salary / Month',
    tunjPPh: 'Tax Allowance / Month',
    tunjLain: 'Other Allowances / Month',
    bonus: mode => (mode === 'ter' ? 'Bonus / THR (This Month)' : 'Bonus / THR (Annual)'),
    hitung: 'Calculate',
    reset: 'Reset',
    emptyState: 'Fill in the details on the left, then click Calculate to see your result.',
    brutoBulan: 'Gross Income / Month',
    kategoriTer: 'TER Category',
    tarifTer: 'TER Rate',
    pphBulanIni: 'PPh 21 Due This Month',
    brutoSetahun: 'Annual Gross Income',
    biayaJabatan: 'Biaya Jabatan (occupational deduction, max. Rp6M/yr)',
    ptkpRow: 'PTKP (non-taxable income)',
    pkpRow: 'PKP (taxable income)',
    pphSetahun: 'Annual PPh 21',
    pphPerBulan: 'PPh 21 per Month',
    ctaTitle: "Want payroll that's accurate and hassle-free?",
    ctaDesc: 'Madael Consult helps companies manage payroll and PPh 21 compliance professionally.',
    ctaButton: 'Contact Madael Consult',
  },
};

const initialInputs = { status: 'TK0', gaji: '', tunjPPh: '', tunjLain: '', bonus: '' };

export default function KalkulatorPPh21() {
  const { lang } = useLanguage();
  const t = translations[lang];

  const [mode, setMode] = useState('ter');
  const [inputs, setInputs] = useState(initialInputs);
  const [result, setResult] = useState(null);

  const handleChange = (field) => (e) => {
    setInputs((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleReset = () => {
    setInputs(initialInputs);
    setResult(null);
  };

  const handleHitung = () => {
    const gaji = Number(inputs.gaji) || 0;
    const tunjPPh = Number(inputs.tunjPPh) || 0;
    const tunjLain = Number(inputs.tunjLain) || 0;
    const bonus = Number(inputs.bonus) || 0;
    const ptkp = PTKP_DATA[inputs.status];

    if (mode === 'ter') {
      const bruto = gaji + tunjPPh + tunjLain + bonus;
      const rate = getTerRate(ptkp.category, bruto);
      const pph = bruto * (rate / 100);
      setResult({ mode: 'ter', bruto, category: ptkp.category, rate, pph });
    } else {
      const brutoBulanan = gaji + tunjPPh + tunjLain;
      const brutoSetahun = brutoBulanan * 12 + bonus;
      const biayaJabatan = Math.min(brutoSetahun * 0.05, 6000000);
      const netoSetahun = brutoSetahun - biayaJabatan;
      const pkpRaw = netoSetahun - ptkp.amount;
      const pkp = Math.max(Math.floor(pkpRaw / 1000) * 1000, 0);
      const pphSetahun = hitungPasal17(pkp);
      const pphPerBulan = pphSetahun / 12;
      setResult({
        mode: 'tahunan',
        brutoSetahun,
        biayaJabatan,
        ptkp: ptkp.amount,
        pkp,
        pphSetahun,
        pphPerBulan,
      });
    }
  };

  const inputClass =
    'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black focus:outline-none focus:border-madael-red transition-colors';
  const labelClass = 'block text-xs uppercase tracking-[0.1em] text-[#6B6B6B] mb-2';

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
          <p className="text-[#AAA] text-sm max-w-[480px]">
            {t.subtitle}
          </p>
        </div>
      </section>

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

          <div>
            <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] mb-6 border-l-[3px] border-madael-red pl-4">
              {t.dataPenghasilan}
            </h2>

            <div className="mb-5">
              <label className={labelClass}>{t.statusPtkp}</label>
              <select
                value={inputs.status}
                onChange={handleChange('status')}
                className={inputClass}
              >
                {Object.entries(PTKP_DATA).map(([key, val]) => (
                  <option key={key} value={key}>
                    {lang === 'id' ? val.labelId : val.labelEn}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-5">
              <label className={labelClass}>{t.gajiPokok}</label>
              <input type="number" value={inputs.gaji} onChange={handleChange('gaji')} className={inputClass} placeholder="10000000" />
            </div>

            <div className="mb-5">
              <label className={labelClass}>{t.tunjPPh}</label>
              <input type="number" value={inputs.tunjPPh} onChange={handleChange('tunjPPh')} className={inputClass} placeholder="0" />
            </div>

            <div className="mb-5">
              <label className={labelClass}>{t.tunjLain}</label>
              <input type="number" value={inputs.tunjLain} onChange={handleChange('tunjLain')} className={inputClass} placeholder="0" />
            </div>

            <div className="mb-8">
              <label className={labelClass}>{t.bonus(mode)}</label>
              <input type="number" value={inputs.bonus} onChange={handleChange('bonus')} className={inputClass} placeholder="0" />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleHitung}
                className="bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
              >
                {t.hitung}
              </button>
              <button
                onClick={handleReset}
                className="border border-[#E0E0E0] text-[#6B6B6B] px-8 py-3 text-sm font-medium tracking-[0.04em] hover:border-madael-red hover:text-madael-red transition-colors"
              >
                {t.reset}
              </button>
            </div>
          </div>

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
              <div className="border border-[#E0E0E0]">
                <Row label={t.brutoSetahun} value={formatRupiah(result.brutoSetahun)} />
                <Row label={t.biayaJabatan} value={formatRupiah(result.biayaJabatan)} />
                <Row label={t.ptkpRow} value={formatRupiah(result.ptkp)} />
                <Row label={t.pkpRow} value={formatRupiah(result.pkp)} />
                <Row label={t.pphSetahun} value={formatRupiah(result.pphSetahun)} />
                <Row label={t.pphPerBulan} value={formatRupiah(result.pphPerBulan)} highlight />
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="px-10 py-16 bg-[#F4F4F4] border-t border-[#E0E0E0] text-center">
        <h3 className="font-serif text-[24px] font-normal text-black tracking-[-0.02em] mb-3">
          {t.ctaTitle}
        </h3>
        <p className="text-sm text-[#6B6B6B] mb-6 max-w-[480px] mx-auto">
          {t.ctaDesc}
        </p>
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
      <span className={`text-xs uppercase tracking-[0.08em] ${highlight ? 'text-white/80' : 'text-[#6B6B6B]'}`}>{label}</span>
      <span className={`text-sm font-semibold text-right ${highlight ? 'text-white text-base' : 'text-black'}`}>{value}</span>
    </div>
  );
}