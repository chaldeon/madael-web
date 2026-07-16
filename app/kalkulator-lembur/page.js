'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import CalculatorDevWarning from '@/components/CalculatorDevWarning';

const OVERTIME_RULES = {
  biasa: [
    { upTo: 1, multiplier: 1.5 },
    { upTo: Infinity, multiplier: 2 },
  ],
  istirahat6: [
    { upTo: 7, multiplier: 2 },
    { upTo: 8, multiplier: 3 },
    { upTo: Infinity, multiplier: 4 },
  ],
  istirahat5: [
    { upTo: 8, multiplier: 2 },
    { upTo: 9, multiplier: 3 },
    { upTo: Infinity, multiplier: 4 },
  ],
  liburNasional: [
    { upTo: 5, multiplier: 2 },
    { upTo: 6, multiplier: 3 },
    { upTo: Infinity, multiplier: 4 },
  ],
};

// Batas maksimal lembur harian sesuai Pasal 26 PP No. 35 Tahun 2021
// (turunan UU Cipta Kerja / UU No. 6 Tahun 2023) — berlaku untuk hari kerja biasa.
const MAX_JAM_LEMBUR_HARIAN = 4;
const MAX_JAM_LEMBUR_MINGGUAN = 18;

function getMultiplier(dayType, hour) {
  const rules = OVERTIME_RULES[dayType];
  for (const r of rules) {
    if (hour <= r.upTo) return r.multiplier;
  }
  return rules[rules.length - 1].multiplier;
}

function computeBreakdown(dayType, jamLembur, upahPerJam) {
  const segments = [];
  let current = null;
  for (let h = 1; h <= jamLembur; h++) {
    const multiplier = getMultiplier(dayType, h);
    if (current && current.multiplier === multiplier) {
      current.count += 1;
      current.to = h;
    } else {
      if (current) segments.push(current);
      current = { from: h, to: h, count: 1, multiplier };
    }
  }
  if (current) segments.push(current);
  return segments.map((seg) => ({
    ...seg,
    ratePerJam: upahPerJam * seg.multiplier,
    subtotal: upahPerJam * seg.multiplier * seg.count,
  }));
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
    title: 'Kalkulator Upah Lembur',
    subtitle: 'Hitung upah lembur berdasarkan UU Cipta Kerja dan PP 35/2021.',
    dataLembur: 'Data Lembur',
    hasilPerhitungan: 'Hasil Perhitungan',
    upahSebulan: 'Upah Sebulan',
    jenisHari: 'Jenis Hari',
    jamLembur: 'Jumlah Jam Lembur (Hari Ini)',
    hitung: 'Hitung',
    reset: 'Reset',
    emptyState: 'Isi data di kiri lalu klik Hitung untuk melihat hasilnya.',
    upahPerJamLabel: 'Upah per Jam (1/173 × Upah Sebulan)',
    breakdownTitle: 'Rincian per Jam',
    totalLembur: 'Total Upah Lembur',
    catatan: '* Dihitung berdasarkan Pasal 31 PP No. 35 Tahun 2021 tentang Pengupahan (turunan UU Cipta Kerja / UU No. 6 Tahun 2023). Upah per jam = 1/173 × upah sebulan (gaji pokok + tunjangan tetap).',
    peringatanBatas: `⚠️ Jam lembur yang dimasukkan melebihi batas maksimal harian. Berdasarkan Pasal 26 PP No. 35 Tahun 2021 (turunan UU Cipta Kerja/UU No. 6 Tahun 2023 yang mengubah UU Ketenagakerjaan), waktu kerja lembur pada hari kerja biasa hanya boleh dilakukan paling lama ${MAX_JAM_LEMBUR_HARIAN} jam dalam 1 hari dan ${MAX_JAM_LEMBUR_MINGGUAN} jam dalam 1 minggu.`,
    jamKe: (from, to) => (from === to ? `Jam ke-${from}` : `Jam ke-${from} s.d. ${to}`),
    dayOptions: {
      biasa: 'Hari Kerja Biasa (Senin–Jumat)',
      istirahat6: 'Hari Istirahat/Libur (6 Hari Kerja Seminggu)',
      istirahat5: 'Hari Istirahat/Libur (5 Hari Kerja Seminggu)',
      liburNasional: 'Hari Libur Nasional (Hari Kerja Terpendek)',
    },
    fields: {
      upahSebulan: { label: 'Upah Sebulan', tip: 'Gaji pokok + tunjangan tetap per bulan. Jadi dasar perhitungan upah per jam (1/173 × upah sebulan).' },
      jenisHari: { label: 'Jenis Hari', tip: 'Jenis hari saat lembur dilakukan menentukan pengali (multiplier) upah lembur per jam, sesuai PP 35/2021.' },
      jamLembur: { label: 'Jumlah Jam Lembur', tip: 'Total jam lembur yang dikerjakan pada hari ini. Setiap jam bisa punya pengali berbeda tergantung urutan jam ke berapa. Untuk hari kerja biasa, batas maksimal lembur adalah 4 jam/hari sesuai PP 35/2021.' },
    },
  },
  en: {
    eyebrow: 'Free Tool',
    title: 'Overtime Pay Calculator',
    subtitle: 'Calculate overtime pay based on the Job Creation Law and PP 35/2021.',
    dataLembur: 'Overtime Details',
    hasilPerhitungan: 'Calculation Result',
    upahSebulan: 'Monthly Wage',
    jenisHari: 'Day Type',
    jamLembur: 'Overtime Hours (Today)',
    hitung: 'Calculate',
    reset: 'Reset',
    emptyState: 'Fill in the details on the left, then click Calculate to see your result.',
    upahPerJamLabel: 'Hourly Wage (1/173 × Monthly Wage)',
    breakdownTitle: 'Hourly Breakdown',
    totalLembur: 'Total Overtime Pay',
    catatan: "* Calculated per Article 31 of PP No. 35 of 2021 on Wages (derived from the Job Creation Law / Law No. 6 of 2023). Hourly wage = 1/173 × monthly wage (basic salary + fixed allowance).",
    peringatanBatas: `⚠️ The overtime hours entered exceed the daily maximum limit. Under Article 26 of PP No. 35 of 2021 (derived from the Job Creation Law/Law No. 6 of 2023, which amended the Manpower Law), overtime work on a regular working day may only be performed for a maximum of ${MAX_JAM_LEMBUR_HARIAN} hours per day and ${MAX_JAM_LEMBUR_MINGGUAN} hours per week.`,
    jamKe: (from, to) => (from === to ? `Hour ${from}` : `Hours ${from}–${to}`),
    dayOptions: {
      biasa: 'Regular Working Day (Mon–Fri)',
      istirahat6: 'Weekly Rest/Holiday (6-Day Work Week)',
      istirahat5: 'Weekly Rest/Holiday (5-Day Work Week)',
      liburNasional: 'National Holiday (Shortest Working Day)',
    },
    fields: {
      upahSebulan: { label: 'Upah Sebulan (Monthly Wage)', tip: 'Basic salary + fixed allowance per month. Base for the hourly wage calculation (1/173 × monthly wage).' },
      jenisHari: { label: 'Jenis Hari (Day Type)', tip: 'The type of day overtime is worked determines the pay multiplier per hour, per PP 35/2021.' },
      jamLembur: { label: 'Overtime Hours', tip: 'Total overtime hours worked today. Each hour may have a different multiplier depending on its sequence. For regular working days, the legal maximum is 4 hours/day per PP 35/2021.' },
    },
  },
};

const initialInputs = {
  upahSebulan: '',
  dayType: 'biasa',
  jamLembur: '',
};

// ============ TOOLTIP (sama dengan kalkulator lain) ============
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

export default function KalkulatorLembur() {
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
    const upahSebulan = Number(inputs.upahSebulan) || 0;
    const jamLembur = Number(inputs.jamLembur) || 0;
    const upahPerJam = upahSebulan / 173;

    const breakdown = computeBreakdown(inputs.dayType, jamLembur, upahPerJam);
    const total = breakdown.reduce((sum, seg) => sum + seg.subtotal, 0);

    // Peringatan batas maksimal hanya berlaku untuk hari kerja biasa (Pasal 26 PP 35/2021)
    const melebihiBatas = inputs.dayType === 'biasa' && jamLembur > MAX_JAM_LEMBUR_HARIAN;

    setResult({ upahPerJam, breakdown, total, dayType: inputs.dayType, jamLembur, melebihiBatas });
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
              {t.dataLembur}
            </h2>

            <div className="mb-5">
              <FieldLabel label={t.fields.upahSebulan.label} tooltip={t.fields.upahSebulan.tip} />
              <input
                type="text"
                inputMode="numeric"
                value={formatNumberDisplay(inputs.upahSebulan, lang)}
                onChange={handleNumberChange('upahSebulan')}
                className={inputClass}
                placeholder="0"
              />
            </div>

            <div className="mb-5">
              <FieldLabel label={t.fields.jenisHari.label} tooltip={t.fields.jenisHari.tip} />
              <select
                value={inputs.dayType}
                onChange={(e) => setInputs((p) => ({ ...p, dayType: e.target.value }))}
                className={inputClass}
              >
                {Object.entries(t.dayOptions).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            <div className="mb-8">
              <FieldLabel label={t.fields.jamLembur.label} tooltip={t.fields.jamLembur.tip} />
              <input
                type="text"
                inputMode="numeric"
                value={inputs.jamLembur}
                onChange={handleNumberChange('jamLembur')}
                className={inputClass}
                placeholder="0"
              />
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
                {result.melebihiBatas && (
                  <div className="border border-amber-400 bg-amber-50 text-amber-900 text-xs leading-relaxed px-4 py-3 mb-6 rounded-sm">
                    {t.peringatanBatas}
                  </div>
                )}

                <div className="border border-[#E0E0E0] mb-6">
                  <Row label={t.upahPerJamLabel} value={formatRupiah(result.upahPerJam)} />
                </div>

                <p className="text-xs tracking-[0.02em] text-[#6B6B6B] mb-2 uppercase">{t.breakdownTitle}</p>
                <div className="border border-[#E0E0E0] mb-6">
                  {result.breakdown.map((seg, i) => (
                    <Row
                      key={i}
                      label={`${t.jamKe(seg.from, seg.to)} (${seg.multiplier}×)`}
                      value={formatRupiah(seg.subtotal)}
                    />
                  ))}
                  <Row label={t.totalLembur} value={formatRupiah(result.total)} highlight />
                </div>

                <p className="text-xs text-[#6B6B6B] leading-relaxed">{t.catatan}</p>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="px-10 py-16 bg-[#F4F4F4] border-t border-[#E0E0E0] text-center">
        <h3 className="font-serif text-[24px] font-normal text-black tracking-[-0.02em] mb-3">
          {lang === 'id' ? 'Butuh bantuan menghitung payroll dan lembur karyawan Anda?' : 'Need help calculating your employees\' payroll and overtime?'}
        </h3>
        <p className="text-sm text-[#6B6B6B] mb-6 max-w-[480px] mx-auto">
          {lang === 'id' ? 'Madael Consult membantu perusahaan mengelola payroll secara profesional.' : 'Madael Consult helps companies manage payroll professionally.'}
        </p>
        <a href="https://wa.me/6285121548247?text=Halo%20Madael%20Consult%2C%20saya%20ingin%20konsultasi%20mengenai%20layanan%20payroll%20Anda." target="_blank" rel="noopener noreferrer" className="inline-block bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors">
          {lang === 'id' ? 'Hubungi Madael Consult' : 'Contact Madael Consult'}
        </a>
      </section>
    </>
  );
}