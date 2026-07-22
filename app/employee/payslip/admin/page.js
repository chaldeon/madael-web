'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { X, Plus, Eye, Pencil } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { hitungBPJS, hitungBrutoPPh21, hitungPPh21TER, hitungPenaltyTelat, PTKP_DATA, JKK_OPTIONS } from '@/lib/payroll/calculations';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function buildPeriodeLabel(tahun, bulan) {
  if (!tahun || !bulan) return '';
  const nama = MONTH_NAMES[Number(bulan) - 1];
  return nama ? `${nama} ${tahun}` : '';
}

function previewNomorDokumen(lastNumber) {
  const tahun = new Date().getFullYear();
  const nomorPadded = String((lastNumber || 0) + 1).padStart(3, '0');
  return `INV/${tahun}/${nomorPadded}`;
}

// Sama persis dengan menitTelat() di employee/payroll — dipakai untuk hitung penalty keterlambatan
function menitTelat(clockInIso, jamMasuk) {
  if (!clockInIso || !jamMasuk) return 0;
  const d = new Date(clockInIso);
  const clockMinutes = d.getHours() * 60 + d.getMinutes();
  const [jh, jm] = jamMasuk.split(':').map(Number);
  const jamMasukMinutes = jh * 60 + jm;
  return Math.max(0, clockMinutes - jamMasukMinutes);
}

// Distribusi pembulatan "largest remainder": memastikan total dari beberapa
// komponen yang dibulatkan SELALU sama dengan pembulatan dari total presisi
// (bukan sekadar menjumlah komponen yang sudah dibulatkan sendiri-sendiri,
// yang bisa selisih 1 rupiah). Komponen dengan sisa desimal terbesar yang
// "dinaikkan" duluan.
function roundDistributed(values) {
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

const PENDAPATAN_FIELDS = [
  { key: 'gaji_pokok', label: 'Gaji Pokok' },
  { key: 'lembur', label: 'Lembur' },
  { key: 'tunjangan_transport', label: 'Tunjangan Transport' },
  { key: 'tunjangan_lain', label: 'Tunjangan Lain' },
];

const BPJS_PERUSAHAAN_FIELDS = [
  { key: 'jkk_perusahaan', label: 'JKK Perusahaan' },
  { key: 'jkm_perusahaan', label: 'JKM Perusahaan' },
  { key: 'jht_perusahaan', label: 'JHT Perusahaan' },
  { key: 'jp_perusahaan', label: 'JP Perusahaan' },
];

const POTONGAN_FIELDS = [
  { key: 'jht_karyawan', label: 'JHT Karyawan' },
  { key: 'jp_karyawan', label: 'JP Karyawan' },
  { key: 'bpjs_k_karyawan', label: 'BPJS K Karyawan' },
  { key: 'pph21', label: 'PPh 21' },
  { key: 'penalty', label: 'Penalty (Keterlambatan)' },
];

const NUMERIC_KEYS = [
  ...PENDAPATAN_FIELDS.map((f) => f.key),
  ...BPJS_PERUSAHAAN_FIELDS.map((f) => f.key),
  'bpjs_k_perusahaan',
  ...POTONGAN_FIELDS.map((f) => f.key),
];

const EMPTY_FORM = {
  employee_id: '',
  periode: '',
  periode_label: '',
  nomor_dokumen: '',
  gaji_pokok: 0, lembur: 0, tunjangan_transport: 0, tunjangan_lain: 0,
  bpjs_k_perusahaan: 0,
  jkk_perusahaan: 0, jkm_perusahaan: 0, jht_perusahaan: 0, jp_perusahaan: 0,
  jht_karyawan: 0, jp_karyawan: 0, bpjs_k_karyawan: 0, pph21: 0, penalty: 0,
  rekening: '', metode_pembayaran: 'Transfer', tanggal_pembayaran: '',
  npwp: '', ptkp: '', no_bpjs_k: '', no_bpjs_tk: '',
  is_published: false,
};

function formatRupiah(value) {
  return 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
}

function formatRibuan(value) {
  const num = Number(value) || 0;
  return num === 0 ? '' : num.toLocaleString('id-ID');
}

function NumberField({ label, value, onChange }) {
  const [display, setDisplay] = useState(formatRibuan(value));

  useEffect(() => {
    setDisplay(formatRibuan(value));
  }, [value]);

  const handleChange = (e) => {
    const digitsOnly = e.target.value.replace(/\D/g, '');
    const num = digitsOnly === '' ? 0 : Number(digitsOnly);
    setDisplay(digitsOnly === '' ? '' : num.toLocaleString('id-ID'));
    onChange(num);
  };

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[#6B6B6B]">{label}</span>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9A9A9A]">Rp</span>
        <input
          type="text"
          inputMode="numeric"
          value={display}
          onChange={handleChange}
          placeholder="0"
          className="w-full border border-[#E0E0E0] pl-9 pr-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
        />
      </div>
    </label>
  );
}

function TextField({ label, value, onChange, type = 'text' }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[#6B6B6B]">{label}</span>
      <input
        type={type}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
      />
    </label>
  );
}

function PayslipFormModal({ form, setForm, employees, supabase, onClose, onSubmit, saving, isEdit, saveError }) {
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [loadingPenalty, setLoadingPenalty] = useState(false);
  const [penaltyNote, setPenaltyNote] = useState('');
  const [jkkRate, setJkkRate] = useState(JKK_OPTIONS[0].value);
  const bpjsTkPerusahaan =
    (form.jkk_perusahaan || 0) + (form.jkm_perusahaan || 0) + (form.jht_perusahaan || 0) + (form.jp_perusahaan || 0);
  const totalPendapatan =
    (form.gaji_pokok || 0) + (form.lembur || 0) + (form.tunjangan_transport || 0) + (form.tunjangan_lain || 0) +
    bpjsTkPerusahaan + (form.bpjs_k_perusahaan || 0);
  // Total Potongan = Penalty + BPJS ditanggung karyawan (JHT 2% + JP 1% + Kesehatan 1%) + PPh21
  const totalPotongan =
    (form.penalty || 0) + (form.jht_karyawan || 0) + (form.jp_karyawan || 0) + (form.bpjs_k_karyawan || 0) + (form.pph21 || 0);
  // Take Home Pay = Gaji Pokok + Allowance (Tunjangan) + Compensation (Lembur) − Total Potongan
  const takeHomePay =
    (form.gaji_pokok || 0) + (form.lembur || 0) + (form.tunjangan_transport || 0) + (form.tunjangan_lain || 0) - totalPotongan;

  // Hitung ulang BPJS (+ PPh21 kalau PTKP sudah dipilih) pakai rumus yang
  // SAMA PERSIS dengan employee/payroll (lib/payroll/calculations.js), basis
  // BPJS = Gaji Pokok saja, bruto PPh21 = Gaji Pokok + Tunjangan + kenikmatan
  // BPJS (kesehatan+JKK+JKM) yang ditanggung perusahaan − Penalty.
  const recalcFromPendapatan = (overrides = {}, rateOverride) => {
    const merged = { ...form, ...overrides };
    const gajiPokok = Number(merged.gaji_pokok) || 0;
    const allowance = (Number(merged.tunjangan_transport) || 0) + (Number(merged.tunjangan_lain) || 0);
    const penalty = Number(merged.penalty) || 0;
    const rate = rateOverride !== undefined ? rateOverride : jkkRate;

    const bpjs = hitungBPJS(gajiPokok, rate);
    const brutoPPh21 = hitungBrutoPPh21(gajiPokok, allowance, bpjs, penalty);
    const pph21Result = merged.ptkp ? hitungPPh21TER(brutoPPh21, merged.ptkp) : null;

    // Grup BPJS TK Perusahaan (JKK+JKM+JHT+JP) dibulatkan sekaligus supaya totalnya pas
    const tkPerusahaan = roundDistributed({
      jkk: bpjs.jkk, jkm: bpjs.jkm, jht: bpjs.jhtEmployer, jp: bpjs.jpEmployer,
    });
    // Grup BPJS Karyawan (Kesehatan+JHT+JP) juga sama, supaya Total Potongan pas
    const karyawan = roundDistributed({
      kes: bpjs.kesehatanEmployee, jht: bpjs.jhtEmployee, jp: bpjs.jpEmployee,
    });

    setForm((prev) => ({
      ...prev,
      ...overrides,
      bpjs_k_perusahaan: Math.round(bpjs.kesehatanEmployer),
      bpjs_k_karyawan: karyawan.kes,
      jkk_perusahaan: tkPerusahaan.jkk,
      jkm_perusahaan: tkPerusahaan.jkm,
      jht_perusahaan: tkPerusahaan.jht,
      jht_karyawan: karyawan.jht,
      jp_perusahaan: tkPerusahaan.jp,
      jp_karyawan: karyawan.jp,
      // PPh21 dibulatkan ke bawah (floor) — konvensi resmi DJP untuk PPh21 TER,
      // bukan dibulatkan ke terdekat. Ini penting supaya Total Potongan & THP pas.
      pph21: pph21Result ? Math.floor(pph21Result.pph) : prev.pph21,
    }));
  };

  // Hitung penalty keterlambatan otomatis dari data attendance + work_schedule
  // karyawan pada periode yang dipilih — sama persis dengan employee/payroll.
  const loadPenalty = async (employeeId, periode) => {
    if (!supabase || !employeeId || !periode) return;
    const [year, month] = periode.split('-').map(Number);
    if (!year || !month) return;

    setLoadingPenalty(true);
    setPenaltyNote('');
    try {
      const firstDay = `${periode}-01`;
      const lastDayNum = new Date(year, month, 0).getDate();
      const lastDay = `${periode}-${String(lastDayNum).padStart(2, '0')}`;

      const [{ data: rows }, { data: sched }] = await Promise.all([
        supabase
          .from('attendance')
          .select('clock_in, status_telat')
          .eq('employee_id', employeeId)
          .gte('tanggal', firstDay)
          .lte('tanggal', lastDay),
        supabase.from('work_schedule').select('jam_masuk').eq('employee_id', employeeId).maybeSingle(),
      ]);

      if (!sched?.jam_masuk) {
        setPenaltyNote('Karyawan ini belum punya Jadwal Kerja — penalty tidak bisa dihitung otomatis, dianggap Rp0 (bisa diisi manual).');
        return;
      }

      const totalMenitTelat = (rows || []).reduce((sum, r) => sum + menitTelat(r.clock_in, sched.jam_masuk), 0);
      const penalty = hitungPenaltyTelat(totalMenitTelat);
      recalcFromPendapatan({ penalty });
    } finally {
      setLoadingPenalty(false);
    }
  };

  const handleJkkRateChange = (val) => {
    const rate = Number(val);
    setJkkRate(rate);
    recalcFromPendapatan({}, rate);
  };

  const set = (key) => (val) => setForm((prev) => ({ ...prev, [key]: val }));

  const bulanRef = useRef(null);
  const [periodeTahun = '', periodeBulan = ''] = (form.periode || '').split('-');

  const updatePeriode = (tahun, bulan) => {
    const periode = tahun || bulan ? `${tahun}-${bulan}` : '';
    setForm((prev) => ({
      ...prev,
      periode,
      periode_label: buildPeriodeLabel(tahun, bulan),
    }));
    if (!isEdit && tahun && bulan && form.employee_id) {
      loadPenalty(form.employee_id, `${tahun}-${bulan}`);
    }
  };

  const handleTahunChange = (val) => {
    const tahun = val.replace(/\D/g, '').slice(0, 4);
    updatePeriode(tahun, periodeBulan);
    if (tahun.length === 4) bulanRef.current?.focus();
  };

  const handleBulanChange = (val) => {
    updatePeriode(periodeTahun, val);
  };

  const DEFAULT_KEYS = [
    'rekening', 'metode_pembayaran', 'npwp', 'ptkp', 'no_bpjs_k', 'no_bpjs_tk',
    'gaji_pokok', 'tunjangan_transport', 'tunjangan_lain',
    'bpjs_k_perusahaan', 'jkk_perusahaan', 'jkm_perusahaan', 'jht_perusahaan', 'jp_perusahaan',
    'jht_karyawan', 'jp_karyawan', 'bpjs_k_karyawan', 'pph21',
  ];

  const handleEmployeeChange = async (employeeId) => {
    setForm((prev) => ({ ...prev, employee_id: employeeId }));
    if (isEdit || !employeeId || !supabase) return;

    setLoadingDefaults(true);
    try {
      // 1. Utamakan data dari slip gaji terakhir milik karyawan ini
      const { data: lastSlip } = await supabase
        .from('payslips')
        .select(DEFAULT_KEYS.join(', '))
        .eq('employee_id', employeeId)
        .order('periode', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastSlip) {
        // Saring null (kolom yang di database kosong) supaya tidak jadi controlled input value={null}
        const sanitized = {};
        Object.keys(lastSlip).forEach((key) => {
          if (lastSlip[key] !== null && lastSlip[key] !== undefined) sanitized[key] = lastSlip[key];
        });
        // Rekening/NPWP/no. BPJS dll cukup di-carry apa adanya, tapi BPJS & PPh21
        // dihitung ULANG (bukan sekadar di-copy dari bulan lalu) supaya selalu
        // sinkron dengan Gaji Pokok + PTKP + Kategori JKK saat ini.
        setForm((prev) => ({ ...prev, ...sanitized }));
        recalcFromPendapatan({
          gaji_pokok: sanitized.gaji_pokok ?? 0,
          tunjangan_transport: sanitized.tunjangan_transport ?? 0,
          tunjangan_lain: sanitized.tunjangan_lain ?? 0,
          ptkp: sanitized.ptkp ?? '',
        });
        return;
      }

      // 2. Belum pernah ada slip -> coba ambil dari data master karyawan (payroll)
      const { data: master } = await supabase
        .from('employees_master')
        .select('gaji_pokok, tunjangan, status_ptkp')
        .eq('linked_employee_id', employeeId)
        .maybeSingle();

      if (master) {
        recalcFromPendapatan({
          gaji_pokok: master.gaji_pokok || 0,
          tunjangan_lain: master.tunjangan || 0,
          ptkp: master.status_ptkp || '',
        });
      }
    } finally {
      setLoadingDefaults(false);
    }
    if (form.periode) loadPenalty(employeeId, form.periode);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[1000] flex items-start justify-center overflow-y-auto py-10 px-4">
      <div className="bg-white w-full max-w-[720px] p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-xl text-black">{isEdit ? 'Edit Slip Gaji' : 'Tambah Slip Gaji'}</h2>
          <button onClick={onClose} className="text-[#6B6B6B] hover:text-black">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-6 max-h-[70vh] overflow-y-auto pr-1">
          {/* Info dasar */}
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-xs text-[#6B6B6B]">Karyawan</span>
              <select
                value={form.employee_id}
                onChange={(e) => handleEmployeeChange(e.target.value)}
                disabled={isEdit}
                className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors disabled:bg-[#F4F4F4]"
              >
                <option value="">Pilih karyawan...</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.nama}</option>
                ))}
              </select>
              {loadingDefaults && (
                <span className="text-[11px] text-[#9A9A9A]">Mengambil data default karyawan...</span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[#6B6B6B]">Tahun</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="2026"
                value={periodeTahun}
                onChange={(e) => handleTahunChange(e.target.value)}
                className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[#6B6B6B]">Bulan</span>
              <select
                ref={bulanRef}
                value={periodeBulan}
                onChange={(e) => handleBulanChange(e.target.value)}
                className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
              >
                <option value="">Pilih bulan...</option>
                {MONTH_NAMES.map((nama, i) => {
                  const val = String(i + 1).padStart(2, '0');
                  return <option key={val} value={val}>{nama}</option>;
                })}
              </select>
            </label>
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-xs text-[#6B6B6B]">Periode Label (otomatis)</span>
              <input
                type="text"
                value={form.periode_label}
                readOnly
                className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-[#F4F4F4] cursor-not-allowed"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[#6B6B6B]">Nomor Dokumen (otomatis, kode INV)</span>
              <input
                type="text"
                value={form.nomor_dokumen || (isEdit ? '' : 'Menghitung nomor berikutnya...')}
                readOnly
                className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-[#F4F4F4] cursor-not-allowed"
              />
              {!isEdit && (
                <span className="text-[11px] text-[#9A9A9A]">
                  Preview — nomor final baru resmi dipakai (counter bertambah) saat kamu klik Simpan.
                </span>
              )}
            </label>
            <TextField label="Rekening" value={form.rekening} onChange={set('rekening')} />
          </div>

          {/* Data pajak & BPJS */}
          <div>
            <p className="text-xs font-medium tracking-[0.04em] text-black border-b border-[#E0E0E0] pb-2 mb-3">
              DATA PAJAK &amp; BPJS
            </p>
            <div className="grid grid-cols-2 gap-4">
              <TextField label="NPWP" value={form.npwp} onChange={set('npwp')} />
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">PTKP</span>
                <select
                  value={form.ptkp}
                  onChange={(e) => recalcFromPendapatan({ ptkp: e.target.value })}
                  className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
                >
                  <option value="">Pilih PTKP...</option>
                  {Object.entries(PTKP_DATA).map(([key, v]) => (
                    <option key={key} value={key}>{v.label}</option>
                  ))}
                </select>
              </label>
              <TextField label="Nomor BPJS Kesehatan" value={form.no_bpjs_k} onChange={set('no_bpjs_k')} />
              <TextField label="Nomor BPJS Ketenagakerjaan" value={form.no_bpjs_tk} onChange={set('no_bpjs_tk')} />
            </div>
          </div>

          {/* Pendapatan */}
          <div>
            <p className="text-xs font-medium tracking-[0.04em] text-black border-b border-[#E0E0E0] pb-2 mb-3">
              PENDAPATAN
            </p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <NumberField
                label="Gaji Pokok"
                value={form.gaji_pokok}
                onChange={(val) => recalcFromPendapatan({ gaji_pokok: val })}
              />
              <NumberField label="Lembur" value={form.lembur} onChange={set('lembur')} />
              <NumberField
                label="Tunjangan Transport"
                value={form.tunjangan_transport}
                onChange={(val) => recalcFromPendapatan({ tunjangan_transport: val })}
              />
              <NumberField
                label="Tunjangan Lain"
                value={form.tunjangan_lain}
                onChange={(val) => recalcFromPendapatan({ tunjangan_lain: val })}
              />
            </div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] text-[#9A9A9A]">Rincian BPJS TK Perusahaan (auto-total: {formatRupiah(bpjsTkPerusahaan)})</p>
              <label className="flex items-center gap-2">
                <span className="text-[11px] text-[#9A9A9A] whitespace-nowrap">Kategori JKK</span>
                <select
                  value={jkkRate}
                  onChange={(e) => handleJkkRateChange(e.target.value)}
                  className="border border-[#E0E0E0] px-2 py-1 text-xs text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
                >
                  {JKK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-[11px] text-[#9A9A9A] mb-2 -mt-1">
              BPJS di bawah otomatis dihitung dari Gaji Pokok (rumus sama seperti employee/payroll) — tetap bisa diedit manual kalau perlu.
            </p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {BPJS_PERUSAHAAN_FIELDS.map((f) => (
                <NumberField key={f.key} label={f.label} value={form[f.key]} onChange={set(f.key)} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <NumberField label="BPJS K Perusahaan" value={form.bpjs_k_perusahaan} onChange={set('bpjs_k_perusahaan')} />
            </div>
          </div>

          {/* Potongan */}
          <div>
            <p className="text-xs font-medium tracking-[0.04em] text-black border-b border-[#E0E0E0] pb-2 mb-3">
              POTONGAN
            </p>
            <p className="text-[11px] text-[#9A9A9A] mb-2">
              BPJS Karyawan & PPh21 (TER) otomatis dihitung dari Gaji Pokok + PTKP. Penalty keterlambatan otomatis dihitung dari data absensi periode ini — semua tetap bisa diedit manual.
            </p>
            {loadingPenalty && <p className="text-[11px] text-[#9A9A9A] mb-2">Menghitung penalty keterlambatan...</p>}
            {!loadingPenalty && penaltyNote && <p className="text-[11px] text-amber-600 mb-2">{penaltyNote}</p>}
            <div className="grid grid-cols-2 gap-4">
              {POTONGAN_FIELDS.map((f) => (
                <NumberField key={f.key} label={f.label} value={form[f.key]} onChange={set(f.key)} />
              ))}
            </div>
          </div>

          {/* Info pembayaran */}
          <div>
            <p className="text-xs font-medium tracking-[0.04em] text-black border-b border-[#E0E0E0] pb-2 mb-3">
              INFO PEMBAYARAN
            </p>
            <div className="grid grid-cols-2 gap-4">
              <TextField label="Metode Pembayaran" value={form.metode_pembayaran} onChange={set('metode_pembayaran')} />
              <TextField label="Tanggal Pembayaran" type="date" value={form.tanggal_pembayaran} onChange={set('tanggal_pembayaran')} />
            </div>
          </div>

          {/* Ringkasan real-time */}
          <div className="bg-[#F4F4F4] p-4 flex flex-col gap-1 text-sm">
            <div className="flex justify-between"><span className="text-[#6B6B6B]">Total Pendapatan</span><span className="text-black">{formatRupiah(totalPendapatan)}</span></div>
            <div className="flex justify-between"><span className="text-[#6B6B6B]">Total Potongan</span><span className="text-black">{formatRupiah(totalPotongan)}</span></div>
            <div className="flex justify-between font-medium"><span className="text-black">Take Home Pay</span><span className="text-madael-red">{formatRupiah(takeHomePay)}</span></div>
          </div>
        </div>

        {saveError && (
          <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 mt-4">
            <span>{saveError}</span>
          </div>
        )}

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#E0E0E0]">
          <label className="flex items-center gap-2 text-sm text-[#3D3D3D]">
            <input
              type="checkbox"
              checked={form.is_published}
              onChange={(e) => set('is_published')(e.target.checked)}
            />
            Publish (terlihat oleh karyawan)
          </label>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-5 py-2.5 text-sm text-[#6B6B6B] hover:text-black transition-colors">
              Batal
            </button>
            <button
              onClick={() => onSubmit(bpjsTkPerusahaan)}
              disabled={saving || !form.employee_id || !/^\d{4}-\d{2}$/.test(form.periode || '')}
              className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors disabled:opacity-40"
            >
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PayslipAdminPage() {
  const supabase = createClient();
  const { status } = useModuleAccess('payslip_admin');

  const [payslips, setPayslips] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterPeriode, setFilterPeriode] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [slipsRes, empsRes] = await Promise.all([
      supabase
        .from('payslips')
        .select('*, employees ( id, nama )')
        .order('periode', { ascending: false }),
      supabase
        .from('employees')
        .select('id, nama')
        .eq('status', 'Aktif')
        .order('nama'),
    ]);

    if (slipsRes.error || empsRes.error) {
      setLoadError((slipsRes.error || empsRes.error).message || 'Gagal memuat data slip gaji.');
      setLoading(false);
      return;
    }

    setPayslips(slipsRes.data || []);
    setEmployees(empsRes.data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (status === 'allowed') loadData();
  }, [status, loadData]);

  const filtered = useMemo(() => {
    return payslips.filter((p) => {
      const matchEmp = !filterEmployee || p.employee_id === filterEmployee;
      const matchPeriode = !filterPeriode || p.periode === filterPeriode;
      return matchEmp && matchPeriode;
    });
  }, [payslips, filterEmployee, filterPeriode]);

  const periodeOptions = useMemo(() => {
    return Array.from(new Set(payslips.map((p) => p.periode))).sort().reverse();
  }, [payslips]);

  const openCreate = async () => {
    const tahunSekarang = String(new Date().getFullYear());
    setForm({ ...EMPTY_FORM, periode: `${tahunSekarang}-`, periode_label: '' });
    setEditingId(null);
    setModalOpen(true);
    const { data } = await supabase
      .from('document_counters')
      .select('last_number')
      .eq('kode', 'INV')
      .maybeSingle();
    setForm((prev) => ({ ...prev, nomor_dokumen: previewNomorDokumen(data?.last_number) }));
  };

  const openEdit = (p) => {
    const next = { ...EMPTY_FORM };
    Object.keys(next).forEach((key) => {
      if (p[key] !== undefined && p[key] !== null) next[key] = p[key];
    });
    next.employee_id = p.employee_id;
    setForm(next);
    setEditingId(p.id);
    setModalOpen(true);
  };

  const handleSubmit = async (bpjsTkPerusahaan) => {
    setSaving(true);
    setSaveError(null);
    const payload = { ...form, bpjs_tk_perusahaan: bpjsTkPerusahaan };
    NUMERIC_KEYS.forEach((k) => { payload[k] = Number(payload[k]) || 0; });
    if (!payload.tanggal_pembayaran) payload.tanggal_pembayaran = null;
    delete payload.employees;

    // Jaga-jaga: selalu turunkan ulang Periode Label dari Periode tepat sebelum
    // disimpan, supaya tidak pernah kosong walau ada celah sinkronisasi di form.
    if (/^\d{4}-\d{2}$/.test(payload.periode || '')) {
      const [tahunFinal, bulanFinal] = payload.periode.split('-');
      payload.periode_label = buildPeriodeLabel(tahunFinal, bulanFinal);
    } else {
      setSaving(false);
      setSaveError('Periode belum lengkap, pilih Tahun dan Bulan terlebih dahulu.');
      return;
    }

    // Nomor dokumen baru hanya digenerate (dan counter INV di-increment) saat membuat slip baru
    if (!editingId) {
      const res = await fetch('/api/documents/generate-number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kode_jenis: 'INV' }),
      });
      const numberData = await res.json();
      if (!res.ok) {
        setSaving(false);
        setSaveError(numberData.error || 'Gagal generate nomor dokumen.');
        return;
      }
      payload.nomor_dokumen = numberData.nomor_surat;
    }

    let error;
    if (editingId) {
      ({ error } = await supabase.from('payslips').update(payload).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('payslips').insert(payload));
    }

    setSaving(false);
    if (error) {
      setSaveError(error.message || 'Gagal menyimpan, coba lagi.');
      return;
    }
    setModalOpen(false);
    loadData();
  };

  const togglePublish = async (p) => {
    setActionError(null);
    const { error } = await supabase
      .from('payslips')
      .update({ is_published: !p.is_published })
      .eq('id', p.id);
    if (error) {
      setActionError(`Gagal update status "${p.employees?.nama || 'slip ini'}": ${error.message}`);
    } else {
      setPayslips((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_published: !p.is_published } : x)));
    }
  };

  const calcTHP = (p) => {
    const totalPotongan = (p.penalty || 0) + (p.jht_karyawan || 0) + (p.jp_karyawan || 0) + (p.bpjs_k_karyawan || 0) + (p.pph21 || 0);
    return (p.gaji_pokok || 0) + (p.lembur || 0) + (p.tunjangan_transport || 0) + (p.tunjangan_lain || 0) - totalPotongan;
  };

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  if (status === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat..." />
      </section>
    );
  }

  if (status === 'denied') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Kamu tidak punya akses ke halaman Kelola Slip Gaji.</p>
          <Link
            href="/employee/dashboard"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali ke Dashboard
          </Link>
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px]">
          <ErrorState message={loadError} onRetry={loadData} />
        </div>
      </section>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-10">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Kelola Slip Gaji</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">{payslips.length} total slip gaji</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors"
        >
          <Plus size={16} />
          Tambah Slip Gaji
        </button>
      </div>

      {actionError && (
        <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 mb-4">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="shrink-0 hover:text-red-900">✕</button>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-6">
        <select value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)} className={selectClass}>
          <option value="">Semua Karyawan</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.nama}</option>
          ))}
        </select>
        <select value={filterPeriode} onChange={(e) => setFilterPeriode(e.target.value)} className={selectClass}>
          <option value="">Semua Periode</option>
          {periodeOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
        {loading ? (
          <LoadingState label="Memuat data slip gaji..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            message={
              filterEmployee || filterPeriode
                ? 'Tidak ada slip gaji yang cocok dengan filter ini.'
                : 'Belum ada slip gaji. Klik "Tambah Slip Gaji" untuk mulai.'
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B] tracking-[0.04em]">
                <th className="px-5 py-3 font-medium">Nama Karyawan</th>
                <th className="px-5 py-3 font-medium">Periode</th>
                <th className="px-5 py-3 font-medium">Nomor Dokumen</th>
                <th className="px-5 py-3 font-medium">Take Home Pay</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-[#F0F0F0] last:border-0">
                  <td className="px-5 py-3.5 text-black">{p.employees?.nama || '—'}</td>
                  <td className="px-5 py-3.5 text-[#3D3D3D]">{p.periode_label || p.periode}</td>
                  <td className="px-5 py-3.5 text-[#6B6B6B]">{p.nomor_dokumen || '—'}</td>
                  <td className="px-5 py-3.5 text-black">{formatRupiah(calcTHP(p))}</td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={() => togglePublish(p)}
                      className={`text-xs font-medium px-2.5 py-1.5 transition-colors ${
                        p.is_published ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#F4F4F4] text-[#6B6B6B]'
                      }`}
                    >
                      {p.is_published ? 'Published' : 'Draft'}
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <button onClick={() => openEdit(p)} className="text-[#6B6B6B] hover:text-madael-red" title="Edit">
                        <Pencil size={15} />
                      </button>
                      <Link href={`/employee/payslip/${p.id}`} target="_blank" className="text-[#6B6B6B] hover:text-madael-red" title="Lihat">
                        <Eye size={15} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <PayslipFormModal
          form={form}
          setForm={setForm}
          employees={employees}
          supabase={supabase}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
          saving={saving}
          isEdit={!!editingId}
          saveError={saveError}
        />
      )}
    </div>
  );
}