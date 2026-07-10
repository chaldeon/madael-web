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

// Batas bawah termasuk: 12 bln = tepat 1 tahun -> bracket "1-2 tahun"
function getUPBaseMonths(totalMonths) {
  if (totalMonths < 12) return 1;
  if (totalMonths < 24) return 2;
  if (totalMonths < 36) return 3;
  if (totalMonths < 48) return 4;
  if (totalMonths < 60) return 5;
  if (totalMonths < 72) return 6;
  if (totalMonths < 84) return 7;
  if (totalMonths < 96) return 8;
  return 9;
}

function getUPMKBaseMonths(totalMonths) {
  if (totalMonths < 36) return 0;
  if (totalMonths < 72) return 2;
  if (totalMonths < 108) return 3;
  if (totalMonths < 144) return 4;
  if (totalMonths < 180) return 5;
  if (totalMonths < 216) return 6;
  if (totalMonths < 252) return 7;
  if (totalMonths < 288) return 8;
  return 10;
}

// Hitung jumlah hari kerja (Senin-Jumat) di bulan dari tanggal efektif PHK
function countWeekdaysInMonth(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dow = new Date(year, month, day).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

const REASONS = [
  { key: 'efisiensiTidakBangkrut', upMult: 0.5, upmkMult: 1, hasUP: true },
  { key: 'efisiensiBangkrut', upMult: 1, upmkMult: 1, hasUP: true },
  { key: 'merugi2Tahun', upMult: 0.5, upmkMult: 1, hasUP: true },
  { key: 'perubahanStatus', upMult: 1, upmkMult: 1, hasUP: true },
  { key: 'sakitBerkepanjangan', upMult: 2, upmkMult: 1, hasUP: true },
  { key: 'pensiun', upMult: 1.75, upmkMult: 1, hasUP: true },
  { key: 'meninggalDunia', upMult: 2, upmkMult: 1, hasUP: true },
  { key: 'mengundurkanDiri', upMult: 0, upmkMult: 1, hasUP: false },
];

// ============ TERJEMAHAN ============
const translations = {
  id: {
    eyebrow: 'Tool Gratis',
    title: 'Kalkulator Pesangon PHK',
    subtitle: 'Hitung uang pesangon, uang penghargaan masa kerja, dan uang penggantian hak berdasarkan UU Cipta Kerja.',
    dataPHK: 'Data PHK',
    hasilPerhitungan: 'Hasil Perhitungan',
    hitung: 'Hitung',
    reset: 'Reset',
    emptyState: 'Isi data di kiri lalu klik Hitung untuk melihat hasilnya.',
    upahSebulan: 'Upah Sebulan',
    upLabel: 'Uang Pesangon (UP)',
    upmkLabel: 'Uang Penghargaan Masa Kerja (UPMK)',
    uphLabel: 'Uang Penggantian Hak (UPH)',
    totalLabel: 'Total Pesangon',
    reasonLabel: 'Alasan PHK',
    masaKerjaLabel: 'Masa Kerja',
    tahun: 'tahun',
    bulan: 'bulan',
    catatan: '* Dihitung berdasarkan UU Cipta Kerja. UP dan UPMK ditentukan tabel masa kerja dikalikan multiplier sesuai alasan PHK. UPH = 15% × (UP + UPMK + uang cuti belum diambil). Uang cuti dihitung dari upah harian (upah sebulan ÷ jumlah hari kerja Senin–Jumat di bulan efektif PHK, tanpa memperhitungkan libur nasional) × sisa cuti.',
    noUpNote: 'Karyawan mengundurkan diri tidak mendapat Uang Pesangon (UP), hanya UPMK dan UPH.',
    reasonOptions: {
      efisiensiTidakBangkrut: 'Efisiensi (Perusahaan Tidak Bangkrut)',
      efisiensiBangkrut: 'Efisiensi (Perusahaan Bangkrut)',
      merugi2Tahun: 'Penutupan Karena Merugi 2 Tahun Berturut-turut',
      perubahanStatus: 'Perubahan Status/Penggabungan/Pengambilalihan',
      sakitBerkepanjangan: 'Karyawan Sakit Berkepanjangan',
      pensiun: 'Pensiun',
      meninggalDunia: 'Meninggal Dunia',
      mengundurkanDiri: 'Karyawan Mengundurkan Diri',
    },
    fields: {
      gajiPokok: { label: 'Gaji Pokok', tip: 'Gaji pokok bulanan karyawan. Bagian dari dasar perhitungan upah sebulan.' },
      tunjTetap: { label: 'Tunjangan Tetap', tip: 'Tunjangan rutin bulanan (bukan tunjangan tidak tetap seperti bonus). Ikut jadi dasar perhitungan upah sebulan.' },
      tahunKerja: { label: 'Masa Kerja - Tahun', tip: 'Jumlah tahun penuh masa kerja karyawan, menentukan bracket tabel UP dan UPMK.' },
      bulanKerja: { label: 'Masa Kerja - Bulan', tip: 'Sisa bulan setelah tahun penuh (0-11). Ikut menentukan bracket tabel UP dan UPMK secara presisi.' },
      alasan: { label: 'Alasan PHK', tip: 'Alasan PHK menentukan multiplier UP dan UPMK sesuai UU Cipta Kerja — beberapa alasan mendapat UP lebih besar (misal sakit berkepanjangan, meninggal dunia), sebagian tidak mendapat UP sama sekali (mengundurkan diri).' },
      sisaCuti: { label: 'Sisa Cuti Belum Diambil (hari)', tip: 'Jumlah hari cuti tahunan yang belum diambil karyawan. Dikonversi ke rupiah dan menjadi komponen UPH.' },
      tglEfektif: { label: 'Tanggal Efektif PHK', tip: 'Tanggal PHK berlaku efektif. Dipakai untuk menghitung jumlah hari kerja (Senin–Jumat) di bulan tersebut, sebagai dasar konversi sisa cuti ke rupiah.' },
    },
  },
  en: {
    eyebrow: 'Free Tool',
    title: 'Severance Pay Calculator',
    subtitle: 'Calculate severance pay, long-service pay, and compensation of rights per the Job Creation Law.',
    dataPHK: 'Termination Details',
    hasilPerhitungan: 'Calculation Result',
    hitung: 'Calculate',
    reset: 'Reset',
    emptyState: 'Fill in the details on the left, then click Calculate to see your result.',
    upahSebulan: 'Monthly Wage',
    upLabel: 'Uang Pesangon / UP (Severance Pay)',
    upmkLabel: 'Uang Penghargaan Masa Kerja / UPMK (Long-Service Pay)',
    uphLabel: 'Uang Penggantian Hak / UPH (Compensation of Rights)',
    totalLabel: 'Total Severance',
    reasonLabel: 'Termination Reason',
    masaKerjaLabel: 'Length of Service',
    tahun: 'years',
    bulan: 'months',
    catatan: "* Calculated per the Job Creation Law. UP and UPMK are determined by a length-of-service table multiplied by a reason-based multiplier. UPH = 15% × (UP + UPMK + unused leave pay). Unused leave pay is calculated from the daily wage (monthly wage ÷ number of weekday working days — Mon–Fri — in the effective termination month, excluding national holidays) × remaining leave days.",
    noUpNote: 'Employees who resign do not receive UP (severance pay), only UPMK and UPH.',
    reasonOptions: {
      efisiensiTidakBangkrut: 'Efficiency (Company Not Bankrupt)',
      efisiensiBangkrut: 'Efficiency (Company Bankrupt)',
      merugi2Tahun: 'Closure Due to 2 Consecutive Years of Losses',
      perubahanStatus: 'Change of Status/Merger/Acquisition',
      sakitBerkepanjangan: 'Prolonged Illness',
      pensiun: 'Retirement',
      meninggalDunia: 'Death',
      mengundurkanDiri: 'Employee Resignation',
    },
    fields: {
      gajiPokok: { label: 'Gaji Pokok (Basic Salary)', tip: "Employee's monthly basic salary. Part of the monthly wage calculation base." },
      tunjTetap: { label: 'Tunjangan Tetap (Fixed Allowance)', tip: 'Regular monthly allowance (not irregular allowances like bonuses). Included in the monthly wage calculation base.' },
      tahunKerja: { label: 'Length of Service - Years', tip: 'Number of full years of service, determines the UP and UPMK table bracket.' },
      bulanKerja: { label: 'Length of Service - Months', tip: 'Remaining months after full years (0-11). Refines the UP and UPMK table bracket.' },
      alasan: { label: 'Termination Reason', tip: 'The reason for termination determines the UP and UPMK multiplier per the Job Creation Law — some reasons get a higher UP (e.g. prolonged illness, death), some get no UP at all (resignation).' },
      sisaCuti: { label: 'Remaining Unused Leave (days)', tip: "Number of unused annual leave days. Converted to rupiah and included as a UPH component." },
      tglEfektif: { label: 'Effective Termination Date', tip: 'The date termination takes effect. Used to calculate the number of weekday (Mon–Fri) working days in that month, as the basis for converting unused leave to rupiah.' },
    },
  },
};

const initialInputs = {
  gajiPokok: '',
  tunjTetap: '',
  tahunKerja: '',
  bulanKerja: '',
  alasan: REASONS[0].key,
  sisaCuti: '',
  tglEfektif: '',
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

export default function KalkulatorPesangon() {
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
    const upahSebulan = gajiPokok + tunjTetap;

    const tahunKerja = Number(inputs.tahunKerja) || 0;
    const bulanKerja = Number(inputs.bulanKerja) || 0;
    const totalMonths = tahunKerja * 12 + bulanKerja;

    const reason = REASONS.find((r) => r.key === inputs.alasan);
    const upBaseMonths = reason.hasUP ? getUPBaseMonths(totalMonths) : 0;
    const upmkBaseMonths = getUPMKBaseMonths(totalMonths);

    const up = reason.hasUP ? upBaseMonths * reason.upMult * upahSebulan : 0;
    const upmk = upmkBaseMonths * reason.upmkMult * upahSebulan;

    const sisaCuti = Number(inputs.sisaCuti) || 0;
    const hariKerjaBulan = countWeekdaysInMonth(inputs.tglEfektif);
    const upahHarian = hariKerjaBulan ? upahSebulan / hariKerjaBulan : 0;
    const uangCuti = upahHarian * sisaCuti;

    const uph = 0.15 * (up + upmk + uangCuti);
    const total = up + upmk + uph;

    setResult({ upahSebulan, up, upmk, uangCuti, uph, total, hasUP: reason.hasUP, hariKerjaBulan });
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
              {t.dataPHK}
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

            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <FieldLabel label={t.fields.tahunKerja.label} tooltip={t.fields.tahunKerja.tip} />
                <input
                  type="text"
                  inputMode="numeric"
                  value={inputs.tahunKerja}
                  onChange={handleNumberChange('tahunKerja')}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
              <div>
                <FieldLabel label={t.fields.bulanKerja.label} tooltip={t.fields.bulanKerja.tip} />
                <input
                  type="text"
                  inputMode="numeric"
                  value={inputs.bulanKerja}
                  onChange={handleNumberChange('bulanKerja')}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
            </div>

            <div className="mb-5">
              <FieldLabel label={t.fields.alasan.label} tooltip={t.fields.alasan.tip} />
              <select
                value={inputs.alasan}
                onChange={(e) => setInputs((p) => ({ ...p, alasan: e.target.value }))}
                className={inputClass}
              >
                {REASONS.map((r) => (
                  <option key={r.key} value={r.key}>{t.reasonOptions[r.key]}</option>
                ))}
              </select>
            </div>

            <div className="mb-5">
              <FieldLabel label={t.fields.sisaCuti.label} tooltip={t.fields.sisaCuti.tip} />
              <input
                type="text"
                inputMode="numeric"
                value={inputs.sisaCuti}
                onChange={handleNumberChange('sisaCuti')}
                className={inputClass}
                placeholder="0"
              />
            </div>

            <div className="mb-8">
              <FieldLabel label={t.fields.tglEfektif.label} tooltip={t.fields.tglEfektif.tip} />
              <input
                type="date"
                value={inputs.tglEfektif}
                onChange={(e) => setInputs((p) => ({ ...p, tglEfektif: e.target.value }))}
                className={inputClass}
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
                <div className="border border-[#E0E0E0] mb-4">
                  <Row label={t.upahSebulan} value={formatRupiah(result.upahSebulan)} />
                  <Row label={t.upLabel} value={formatRupiah(result.up)} />
                  <Row label={t.upmkLabel} value={formatRupiah(result.upmk)} />
                  <Row label={t.uphLabel} value={formatRupiah(result.uph)} />
                  <Row label={t.totalLabel} value={formatRupiah(result.total)} highlight />
                </div>

                {!result.hasUP && (
                  <p className="text-xs text-madael-red mb-4">{t.noUpNote}</p>
                )}

                <p className="text-xs text-[#6B6B6B] leading-relaxed">{t.catatan}</p>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="px-10 py-16 bg-[#F4F4F4] border-t border-[#E0E0E0] text-center">
        <h3 className="font-serif text-[24px] font-normal text-black tracking-[-0.02em] mb-3">
          {lang === 'id' ? 'Butuh bantuan mengelola proses PHK dan pesangon karyawan Anda?' : "Need help managing your employees' termination and severance process?"}
        </h3>
        <p className="text-sm text-[#6B6B6B] mb-6 max-w-[480px] mx-auto">
          {lang === 'id' ? 'Madael Consult membantu perusahaan mengelola proses ketenagakerjaan secara profesional.' : 'Madael Consult helps companies manage employment processes professionally.'}
        </p>
        <a href="https://wa.me/6285121548247?text=Halo%20Madael%20Consult%2C%20saya%20ingin%20konsultasi%20mengenai%20pesangon%20PHK." target="_blank" rel="noopener noreferrer" className="inline-block bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors">
          {lang === 'id' ? 'Hubungi Madael Consult' : 'Contact Madael Consult'}
        </a>
      </section>
    </>
  );
}