'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import CalculatorDevWarning from '@/components/CalculatorDevWarning';

const CAP_KESEHATAN = 12000000;
const CAP_JP = 9559600;

const JKK_OPTIONS = [
  { value: 0.0024, labelId: 'Sangat Rendah (0.24%)', labelEn: 'Very Low (0.24%)' },
  { value: 0.0054, labelId: 'Rendah (0.54%)', labelEn: 'Low (0.54%)' },
  { value: 0.0089, labelId: 'Sedang (0.89%)', labelEn: 'Medium (0.89%)' },
  { value: 0.0127, labelId: 'Tinggi (1.27%)', labelEn: 'High (1.27%)' },
  { value: 0.0174, labelId: 'Sangat Tinggi (1.74%)', labelEn: 'Very High (1.74%)' },
];

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
    title: 'Kalkulator BPJS',
    subtitle: 'Simulasikan iuran BPJS Ketenagakerjaan dan BPJS Kesehatan — tanggungan perusahaan dan potongan karyawan.',
    dataGaji: 'Data Gaji',
    hasilPerhitungan: 'Hasil Perhitungan',
    gajiPokok: 'Gaji Pokok',
    tunjTetap: 'Tunjangan Tetap',
    tingkatRisiko: 'Tingkat Risiko JKK',
    hitung: 'Hitung',
    reset: 'Reset',
    emptyState: 'Isi data di kiri lalu klik Hitung untuk melihat hasilnya.',
    tanggunganPerusahaan: 'Tanggungan Perusahaan',
    potonganKaryawan: 'Potongan Karyawan',
    grandTotal: 'Grand Total Biaya BPJS',
    total: 'Total',
    ctaTitle: 'Butuh bantuan mengelola administrasi BPJS dan payroll perusahaan Anda?',
    ctaDesc: 'Madael Consult membantu perusahaan mengelola payroll dan kepatuhan BPJS secara profesional.',
    ctaButton: 'Hubungi Madael Consult',
    fields: {
      gajiPokok: { label: 'Gaji Pokok', tip: 'Gaji pokok bulanan sebelum tunjangan. Jadi dasar utama perhitungan seluruh komponen BPJS.' },
      tunjTetap: { label: 'Tunjangan Tetap', tip: 'Tunjangan rutin yang dibayarkan setiap bulan (bukan tunjangan tidak tetap seperti bonus). Ikut jadi dasar perhitungan BPJS.' },
      jkk: { label: 'Tingkat Risiko JKK', tip: 'Jaminan Kecelakaan Kerja — persentase iuran ditentukan tingkat risiko pekerjaan, dari Sangat Rendah (0.24%) sampai Sangat Tinggi (1.74%). Ditanggung penuh oleh perusahaan.' },
    },
    resultLabels: {
      kesehatanEmployer: 'BPJS Kesehatan (4%)',
      kesehatanEmployee: 'BPJS Kesehatan (1%)',
      jkk: 'JKK',
      jkm: 'JKM (0.3%)',
      jhtEmployer: 'JHT (3.7%)',
      jhtEmployee: 'JHT (2%)',
      jpEmployer: 'JP (2%)',
      jpEmployee: 'JP (1%)',
    },
  },
  en: {
    eyebrow: 'Free Tool',
    title: 'BPJS Calculator',
    subtitle: 'Simulate BPJS Ketenagakerjaan and BPJS Kesehatan contributions — employer and employee shares.',
    dataGaji: 'Salary Details',
    hasilPerhitungan: 'Calculation Result',
    gajiPokok: 'Basic Salary',
    tunjTetap: 'Fixed Allowance',
    tingkatRisiko: 'JKK Risk Level',
    hitung: 'Calculate',
    reset: 'Reset',
    emptyState: 'Fill in the details on the left, then click Calculate to see your result.',
    tanggunganPerusahaan: "Employer's Contribution",
    potonganKaryawan: "Employee's Deduction",
    grandTotal: 'Grand Total BPJS Cost',
    total: 'Total',
    ctaTitle: "Need help managing your company's BPJS and payroll administration?",
    ctaDesc: 'Madael Consult helps companies manage payroll and BPJS compliance professionally.',
    ctaButton: 'Contact Madael Consult',
    fields: {
      gajiPokok: { label: 'Gaji Pokok (Basic Salary)', tip: 'Monthly basic salary before allowances. Main base for all BPJS contribution calculations.' },
      tunjTetap: { label: 'Tunjangan Tetap (Fixed Allowance)', tip: 'Regular monthly allowance (not irregular allowances like bonuses). Included in the BPJS contribution base.' },
      jkk: { label: 'Tingkat Risiko JKK (JKK Risk Level)', tip: 'Jaminan Kecelakaan Kerja (Work Accident Insurance) — contribution rate depends on job risk level, from Very Low (0.24%) to Very High (1.74%). Fully covered by the employer.' },
    },
    resultLabels: {
      kesehatanEmployer: 'BPJS Kesehatan (4%)',
      kesehatanEmployee: 'BPJS Kesehatan (1%)',
      jkk: 'JKK',
      jkm: 'JKM (0.3%)',
      jhtEmployer: 'JHT (3.7%)',
      jhtEmployee: 'JHT (2%)',
      jpEmployer: 'JP (2%)',
      jpEmployee: 'JP (1%)',
    },
  },
};

const initialInputs = {
  gajiPokok: '',
  tunjTetap: '',
  jkkRate: JKK_OPTIONS[0].value,
};

// ============ TOOLTIP (sama persis dengan kalkulator PPh21) ============
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

function Row({ label, value, highlight }) {
  return (
    <div className={`flex justify-between items-center px-6 py-4 border-b border-[#E0E0E0] last:border-b-0 gap-4 ${highlight ? 'bg-madael-red' : 'bg-white'}`}>
      <span className={`text-xs tracking-[0.02em] ${highlight ? 'text-white/80' : 'text-[#6B6B6B]'}`}>{label}</span>
      <span className={`text-sm font-semibold text-right ${highlight ? 'text-white text-base' : 'text-black'}`}>{value}</span>
    </div>
  );
}

export default function KalkulatorBPJS() {
  const { lang } = useLanguage();
  const t = translations[lang];

  const [inputs, setInputs] = useState(initialInputs);
  const [result, setResult] = useState(null);

  const handleNumberChange = (field) => (e) => {
    const raw = e.target.value.replace(/[^\d]/g, '');
    setInputs((prev) => ({ ...prev, [field]: raw }));
  };

  const handleReset = () => {
    setInputs(initialInputs);
    setResult(null);
  };

  const handleHitung = () => {
    const gajiPokok = Number(inputs.gajiPokok) || 0;
    const tunjTetap = Number(inputs.tunjTetap) || 0;
    const totalGaji = gajiPokok + tunjTetap;

    const basisKesehatan = Math.min(totalGaji, CAP_KESEHATAN);
    const basisJP = Math.min(totalGaji, CAP_JP);

    const kesehatanEmployer = basisKesehatan * 0.04;
    const kesehatanEmployee = basisKesehatan * 0.01;
    const jkk = totalGaji * inputs.jkkRate;
    const jkm = totalGaji * 0.003;
    const jhtEmployer = totalGaji * 0.037;
    const jhtEmployee = totalGaji * 0.02;
    const jpEmployer = basisJP * 0.02;
    const jpEmployee = basisJP * 0.01;

    const totalEmployer = kesehatanEmployer + jkk + jkm + jhtEmployer + jpEmployer;
    const totalEmployee = kesehatanEmployee + jhtEmployee + jpEmployee;
    const grandTotal = totalEmployer + totalEmployee;

    setResult({
      kesehatanEmployer, kesehatanEmployee, jkk, jkm,
      jhtEmployer, jhtEmployee, jpEmployer, jpEmployee,
      totalEmployer, totalEmployee, grandTotal,
    });
  };

  const inputClass =
    'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black focus:outline-none focus:border-madael-red transition-colors';

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

      <section className="px-10 py-10 bg-white">
        <div className="max-w-[1100px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-12">

          {/* ============ INPUT ============ */}
          <div>
            <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] mb-6 border-l-[3px] border-madael-red pl-4">
              {t.dataGaji}
            </h2>

            <div className="mb-5">
              <FieldLabel label={t.fields.gajiPokok.label} tooltip={t.fields.gajiPokok.tip} />
              <input
                type="text"
                inputMode="numeric"
                value={formatNumberDisplay(inputs.gajiPokok, lang)}
                onChange={handleNumberChange('gajiPokok')}
                className={inputClass}
                placeholder="0"
              />
            </div>

            <div className="mb-5">
              <FieldLabel label={t.fields.tunjTetap.label} tooltip={t.fields.tunjTetap.tip} />
              <input
                type="text"
                inputMode="numeric"
                value={formatNumberDisplay(inputs.tunjTetap, lang)}
                onChange={handleNumberChange('tunjTetap')}
                className={inputClass}
                placeholder="0"
              />
            </div>

            <div className="mb-8">
              <FieldLabel label={t.fields.jkk.label} tooltip={t.fields.jkk.tip} />
              <select
                value={inputs.jkkRate}
                onChange={(e) => setInputs((p) => ({ ...p, jkkRate: parseFloat(e.target.value) }))}
                className={inputClass}
              >
                {JKK_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {lang === 'id' ? opt.labelId : opt.labelEn}
                  </option>
                ))}
              </select>
            </div>

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

            {result && (
              <>
                <p className="text-xs tracking-[0.02em] text-[#6B6B6B] mb-2 uppercase">{t.tanggunganPerusahaan}</p>
                <div className="border border-[#E0E0E0] mb-6">
                  <Row label={t.resultLabels.kesehatanEmployer} value={formatRupiah(result.kesehatanEmployer)} />
                  <Row label={t.resultLabels.jkk} value={formatRupiah(result.jkk)} />
                  <Row label={t.resultLabels.jkm} value={formatRupiah(result.jkm)} />
                  <Row label={t.resultLabels.jhtEmployer} value={formatRupiah(result.jhtEmployer)} />
                  <Row label={t.resultLabels.jpEmployer} value={formatRupiah(result.jpEmployer)} />
                  <Row label={t.total} value={formatRupiah(result.totalEmployer)} highlight />
                </div>

                <p className="text-xs tracking-[0.02em] text-[#6B6B6B] mb-2 uppercase">{t.potonganKaryawan}</p>
                <div className="border border-[#E0E0E0] mb-6">
                  <Row label={t.resultLabels.kesehatanEmployee} value={formatRupiah(result.kesehatanEmployee)} />
                  <Row label={t.resultLabels.jhtEmployee} value={formatRupiah(result.jhtEmployee)} />
                  <Row label={t.resultLabels.jpEmployee} value={formatRupiah(result.jpEmployee)} />
                  <Row label={t.total} value={formatRupiah(result.totalEmployee)} highlight />
                </div>

                <div className="border border-[#E0E0E0]">
                  <Row label={t.grandTotal} value={formatRupiah(result.grandTotal)} highlight />
                </div>
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