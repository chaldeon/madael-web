'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

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

// ============ METODE KALENDER ============
// Bulan dihitung dari selisih bulan-kalender asli (mis. 1 Feb - 31 Jul = pas 6 bulan,
// tanpa sisa hari, walau Feb/Mar/Mei/Jul punya jumlah hari berbeda-beda).
function computeMasaKerjaKalender(startStr, endStr) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  if (end < start) return null;

  // Geser end +1 hari supaya penghitungan bersifat inklusif
  // (1 Feb s.d. 31 Jul dianggap genap sampai 1 Agu, bukan 31 Jul).
  const endPlusOne = new Date(end);
  endPlusOne.setDate(endPlusOne.getDate() + 1);

  let months = (endPlusOne.getFullYear() - start.getFullYear()) * 12
             + (endPlusOne.getMonth() - start.getMonth());
  let days = endPlusOne.getDate() - start.getDate();

  if (days < 0) {
    months -= 1;
    const prevMonthLastDate = new Date(endPlusOne.getFullYear(), endPlusOne.getMonth(), 0).getDate();
    days += prevMonthLastDate;
  }
  if (months < 0) return null;

  const totalDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
  const bulanDesimal = months + days / 30;

  return { totalDays, bulanBulat: months, sisaHari: days, bulanDesimal };
}

// ============ METODE 30 HARI/BULAN (FLAT) ============
// Total hari kontrak dibagi rata 30 hari per bulan — sederhana dan konsisten,
// tapi bisa menghasilkan sisa hari untuk kontrak yang sebenarnya genap per kalender.
function computeMasaKerjaFlat30(startStr, endStr) {
  const start = new Date(startStr);
  const end = new Date(endStr);
  const totalDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
  if (totalDays <= 0) return null;

  const bulanBulat = Math.floor(totalDays / 30);
  const sisaHari = totalDays % 30;
  const bulanDesimal = totalDays / 30;

  return { totalDays, bulanBulat, sisaHari, bulanDesimal };
}

function computeMasaKerja(mode, startStr, endStr) {
  if (!startStr || !endStr) return null;
  return mode === 'flat30'
    ? computeMasaKerjaFlat30(startStr, endStr)
    : computeMasaKerjaKalender(startStr, endStr);
}

// ============ TERJEMAHAN ============
const translations = {
  id: {
    eyebrow: 'Tool Gratis',
    title: 'Kalkulator Kompensasi PKWT',
    subtitle: 'Hitung uang kompensasi karyawan kontrak (PKWT) yang habis masa kerjanya sesuai PP 35/2021.',
    dataKontrak: 'Data Kontrak',
    hasilPerhitungan: 'Hasil Perhitungan',
    hitung: 'Hitung',
    reset: 'Reset',
    emptyState: 'Isi data di kiri lalu klik Hitung untuk melihat hasilnya.',
    invalidDate: 'Tanggal berakhir harus setelah tanggal mulai.',
    totalUpah: 'Total Upah (Gaji Pokok + Tunjangan Tetap)',
    masaKerjaLabel: 'Masa Kerja',
    kompensasiLabel: 'Kompensasi PKWT',
    masaKerjaFormat: (bulan, hari) => `${bulan} bulan ${hari} hari`,
    catatan: '* Dihitung berdasarkan PP 35/2021 Pasal 15–18 tentang Kompensasi PKWT. Kompensasi = (masa kerja dalam bulan ÷ 12) × 1 bulan upah, dibayarkan saat PKWT berakhir (tidak diperpanjang). Untuk PKWT yang diperpanjang, kompensasi dibayar per periode kontrak, bukan diakumulasikan dari periode sebelumnya — hitung ulang per periode secara terpisah.',
    fields: {
      gajiPokok: { label: 'Gaji Pokok', tip: 'Gaji pokok bulanan karyawan PKWT. Jadi bagian dari dasar perhitungan kompensasi.' },
      tunjTetap: { label: 'Tunjangan Tetap', tip: 'Tunjangan rutin yang dibayarkan setiap bulan (bukan tunjangan tidak tetap seperti bonus). Ikut jadi dasar perhitungan kompensasi.' },
      tglMulai: { label: 'Tanggal Mulai PKWT', tip: 'Tanggal mulai berlakunya kontrak kerja waktu tertentu (PKWT), sesuai yang tertulis di perjanjian kerja.' },
      tglBerakhir: { label: 'Tanggal Berakhir PKWT', tip: 'Tanggal berakhirnya masa kontrak PKWT saat ini (bukan tanggal perpanjangan, kalau ada perpanjangan hitung terpisah per periode).' },
      metodeMasaKerja: {
        label: 'Metode Hitung Masa Kerja',
        tip: 'Kalender: bulan dihitung dari tanggal kalender asli (mis. 1 Feb–31 Jul = pas 6 bulan tanpa sisa hari). 30 Hari/Bulan (Flat): setiap bulan dianggap tepat 30 hari — lebih sederhana, tapi kontrak yang sebenarnya genap per kalender bisa muncul sisa hari. Pilih metode yang sesuai kebiasaan perhitungan HR Anda.',
      },
    },
    metodeOptions: {
      kalender: 'Kalender (bulan kalender asli)',
      flat30: '30 Hari/Bulan (Flat)',
    },
  },
  en: {
    eyebrow: 'Free Tool',
    title: 'PKWT Compensation Calculator',
    subtitle: "Calculate end-of-contract compensation for fixed-term (PKWT) employees per PP 35/2021.",
    dataKontrak: 'Contract Details',
    hasilPerhitungan: 'Calculation Result',
    hitung: 'Calculate',
    reset: 'Reset',
    emptyState: 'Fill in the details on the left, then click Calculate to see your result.',
    invalidDate: 'End date must be after the start date.',
    totalUpah: 'Total Wage (Basic Salary + Fixed Allowance)',
    masaKerjaLabel: 'Length of Service',
    kompensasiLabel: 'PKWT Compensation',
    masaKerjaFormat: (bulan, hari) => `${bulan} months ${hari} days`,
    catatan: "* Calculated per PP 35/2021 Articles 15–18 on PKWT Compensation. Compensation = (length of service in months ÷ 12) × 1 month's wage, paid when the PKWT ends (not renewed). For renewed PKWT, compensation is paid per contract period, not accumulated from prior periods — calculate each period separately.",
    fields: {
      gajiPokok: { label: 'Gaji Pokok (Basic Salary)', tip: "Employee's monthly basic salary. Part of the compensation calculation base." },
      tunjTetap: { label: 'Tunjangan Tetap (Fixed Allowance)', tip: 'Regular monthly allowance (not irregular allowances like bonuses). Included in the compensation calculation base.' },
      tglMulai: { label: 'Tanggal Mulai PKWT (Contract Start Date)', tip: 'Start date of the fixed-term employment contract (PKWT), as stated in the employment agreement.' },
      tglBerakhir: { label: 'Tanggal Berakhir PKWT (Contract End Date)', tip: 'End date of the current PKWT period (not a renewal date — renewals are calculated as separate periods).' },
      metodeMasaKerja: {
        label: 'Length-of-Service Calculation Method',
        tip: 'Calendar: months are counted from actual calendar dates (e.g. Feb 1–Jul 31 = exactly 6 months, no leftover days). 30 Days/Month (Flat): every month is treated as exactly 30 days — simpler, but contracts that are actually calendar-exact can show leftover days. Choose whichever matches your HR convention.',
      },
    },
    metodeOptions: {
      kalender: 'Calendar (actual calendar months)',
      flat30: '30 Days/Month (Flat)',
    },
  },
};

const initialInputs = {
  gajiPokok: '',
  tunjTetap: '',
  tglMulai: '',
  tglBerakhir: '',
  masaKerjaMode: 'kalender',
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

export default function KalkulatorPKWT() {
  const { lang } = useLanguage();
  const t = translations[lang];

  const [inputs, setInputs] = useState(initialInputs);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleNumberChange = (field) => (e) => {
    const raw = e.target.value.replace(/[^\d]/g, '');
    setInputs((prev) => ({ ...prev, [field]: raw }));
  };

  const handleReset = () => {
    setInputs(initialInputs);
    setResult(null);
    setError('');
  };

  const handleHitung = () => {
    setError('');
    const gajiPokok = Number(inputs.gajiPokok) || 0;
    const tunjTetap = Number(inputs.tunjTetap) || 0;
    const totalUpah = gajiPokok + tunjTetap;

    if (!inputs.tglMulai || !inputs.tglBerakhir) return;

    const masaKerja = computeMasaKerja(inputs.masaKerjaMode, inputs.tglMulai, inputs.tglBerakhir);
    if (!masaKerja) {
      setError(t.invalidDate);
      setResult(null);
      return;
    }

    const kompensasi = (masaKerja.bulanDesimal / 12) * totalUpah;

    setResult({ totalUpah, masaKerja, kompensasi });
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

      <section className="px-10 py-10 bg-white">
        <div className="max-w-[1100px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-12">

          {/* ============ INPUT ============ */}
          <div>
            <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] mb-6 border-l-[3px] border-madael-red pl-4">
              {t.dataKontrak}
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

            <div className="mb-5">
              <FieldLabel label={t.fields.tglMulai.label} tooltip={t.fields.tglMulai.tip} />
              <input
                type="date"
                value={inputs.tglMulai}
                onChange={(e) => setInputs((p) => ({ ...p, tglMulai: e.target.value }))}
                className={inputClass}
              />
            </div>

            <div className="mb-5">
              <FieldLabel label={t.fields.tglBerakhir.label} tooltip={t.fields.tglBerakhir.tip} />
              <input
                type="date"
                value={inputs.tglBerakhir}
                onChange={(e) => setInputs((p) => ({ ...p, tglBerakhir: e.target.value }))}
                className={inputClass}
              />
            </div>

            <div className="mb-8">
              <FieldLabel label={t.fields.metodeMasaKerja.label} tooltip={t.fields.metodeMasaKerja.tip} />
              <select
                value={inputs.masaKerjaMode}
                onChange={(e) => setInputs((p) => ({ ...p, masaKerjaMode: e.target.value }))}
                className={inputClass}
              >
                <option value="kalender">{t.metodeOptions.kalender}</option>
                <option value="flat30">{t.metodeOptions.flat30}</option>
              </select>
            </div>

            {error && <p className="text-xs text-madael-red mb-4">{error}</p>}

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
                <div className="border border-[#E0E0E0] mb-6">
                  <Row label={t.totalUpah} value={formatRupiah(result.totalUpah)} />
                  <Row
                    label={t.masaKerjaLabel}
                    value={t.masaKerjaFormat(result.masaKerja.bulanBulat, result.masaKerja.sisaHari)}
                  />
                  <Row label={t.kompensasiLabel} value={formatRupiah(result.kompensasi)} highlight />
                </div>

                <p className="text-xs text-[#6B6B6B] leading-relaxed">{t.catatan}</p>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="px-10 py-16 bg-[#F4F4F4] border-t border-[#E0E0E0] text-center">
        <h3 className="font-serif text-[24px] font-normal text-black tracking-[-0.02em] mb-3">
          {lang === 'id' ? 'Butuh bantuan mengelola kontrak PKWT karyawan Anda?' : "Need help managing your employees' PKWT contracts?"}
        </h3>
        <p className="text-sm text-[#6B6B6B] mb-6 max-w-[480px] mx-auto">
          {lang === 'id' ? 'Madael Consult membantu perusahaan mengelola dokumen ketenagakerjaan secara profesional.' : 'Madael Consult helps companies manage employment documentation professionally.'}
        </p>
        <a href="https://wa.me/6285121548247?text=Halo%20Madael%20Consult%2C%20saya%20ingin%20konsultasi%20mengenai%20kontrak%20PKWT." target="_blank" rel="noopener noreferrer" className="inline-block bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors">
          {lang === 'id' ? 'Hubungi Madael Consult' : 'Contact Madael Consult'}
        </a>
      </section>
    </>
  );
}
