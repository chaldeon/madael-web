'use client';

import { useState, useRef } from 'react';
import { X } from 'lucide-react';
import { hitungBPJS, hitungBrutoPPh21, hitungPPh21TER, hitungPenaltyTelat, PTKP_DATA, JKK_OPTIONS } from '@/lib/payroll/calculations';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { menitTelatUntukPayroll } from '@/lib/attendanceStatus';
import { MONTH_NAMES, buildPeriodeLabel, roundDistributed, BPJS_PERUSAHAAN_FIELDS, POTONGAN_FIELDS } from '@/lib/payslipAdminConfig';
import NumberField from '@/components/payslip-admin/NumberField';
import TextField from '@/components/payslip-admin/TextField';
import ReadOnlyField from '@/components/payslip-admin/ReadOnlyField';
import { formatRupiah } from '@/lib/format';

export default function PayslipFormModal({ form, setForm, employees, supabase, onClose, onSubmit, saving, isEdit, saveError, isDirty }) {
  const handleModalBackdrop = useModalDismiss(true, onClose, undefined, isDirty);
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [loadingPenalty, setLoadingPenalty] = useState(false);
  const [penaltyNote, setPenaltyNote] = useState('');
  const [jkkRate, setJkkRate] = useState(JKK_OPTIONS[0].value);
  const bpjsTkPerusahaan =
    (form.jkk_perusahaan || 0) + (form.jkm_perusahaan || 0) + (form.jht_perusahaan || 0) + (form.jp_perusahaan || 0);
  const totalPendapatan =
    (form.gaji_pokok || 0) + (form.lembur || 0) + (form.insentif || 0) + (form.kompensasi || 0) + (form.tunjangan_lain || 0) +
    bpjsTkPerusahaan + (form.bpjs_k_perusahaan || 0);
  // Total Potongan = Penalty + BPJS ditanggung karyawan (JHT 2% + JP 1% + Kesehatan 1%) + PPh21
  const totalPotongan =
    (form.penalty || 0) + (form.jht_karyawan || 0) + (form.jp_karyawan || 0) + (form.bpjs_k_karyawan || 0) + (form.pph21 || 0);
  // Take Home Pay = Gaji Pokok + Overtime + Incentive + Compensation Fund + Allowance − Total Potongan
  const takeHomePay =
    (form.gaji_pokok || 0) + (form.lembur || 0) + (form.insentif || 0) + (form.kompensasi || 0) + (form.tunjangan_lain || 0) - totalPotongan;

  // Hitung ulang BPJS (+ PPh21 kalau PTKP sudah dipilih) pakai rumus yang
  // SAMA PERSIS dengan employee/payroll (lib/payroll/calculations.js), basis
  // BPJS = Gaji Pokok saja, bruto PPh21 = Gaji Pokok + Allowance (Transport/
  // Travel/Communication + Overtime + Incentive + Compensation Fund) +
  // kenikmatan BPJS (kesehatan+JKK+JKM) yang ditanggung perusahaan − Penalty.
  const recalcFromPendapatan = (overrides = {}, rateOverride) => {
    const merged = { ...form, ...overrides };
    const gajiPokok = Number(merged.gaji_pokok) || 0;
    const allowance =
      (Number(merged.tunjangan_lain) || 0) +
      (Number(merged.lembur) || 0) +
      (Number(merged.insentif) || 0) +
      (Number(merged.kompensasi) || 0);
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
          .select('clock_in, status_telat, justified, toleransi_menit')
          .eq('employee_id', employeeId)
          .gte('tanggal', firstDay)
          .lte('tanggal', lastDay),
        supabase.from('work_schedule').select('jam_masuk').eq('employee_id', employeeId).maybeSingle(),
      ]);

      if (!sched?.jam_masuk) {
        setPenaltyNote('Karyawan ini belum punya Jadwal Kerja — penalty tidak bisa dihitung otomatis, dianggap Rp0 (bisa diisi manual).');
        return;
      }

      const totalMenitTelat = (rows || []).reduce((sum, r) => sum + menitTelatUntukPayroll(r, sched.jam_masuk), 0);
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

  const handleEmployeeChange = async (employeeId) => {
    setForm((prev) => ({ ...prev, employee_id: employeeId }));
    if (isEdit || !employeeId || !supabase) return;

    setLoadingDefaults(true);
    try {
      // Task 25 — employees_master adalah SATU-SATUNYA sumber untuk data
      // standing (rekening, NPWP, PTKP, no. BPJS, gaji pokok, tunjangan).
      // TIDAK lagi copy-forward dari slip gaji bulan lalu — supaya kalau ada
      // perubahan (mis. NPWP baru diurus, pindah rekening), cukup diupdate
      // sekali di Payroll Manager dan otomatis kepakai di slip berikutnya.
      const { data: master } = await supabase
        .from('employees_master')
        .select('gaji_pokok, tunjangan, status_ptkp, npwp, no_bpjs_kesehatan, no_bpjs_ketenagakerjaan, no_rekening, jkk_rate')
        .eq('linked_employee_id', employeeId)
        .maybeSingle();

      if (master) {
        setForm((prev) => ({
          ...prev,
          rekening: master.no_rekening || '',
          npwp: master.npwp || '',
          ptkp: master.status_ptkp || '',
          no_bpjs_k: master.no_bpjs_kesehatan || '',
          no_bpjs_tk: master.no_bpjs_ketenagakerjaan || '',
        }));
        const rate = master.jkk_rate != null ? master.jkk_rate : JKK_OPTIONS[0].value;
        setJkkRate(rate);
        recalcFromPendapatan({
          gaji_pokok: master.gaji_pokok || 0,
          tunjangan_lain: master.tunjangan || 0,
          // Overtime/Incentive/Compensation Fund SENGAJA tidak di-reset di
          // sini — itu input manual per periode, beda dari standing data.
          ptkp: master.status_ptkp || '',
        }, rate);
      } else {
        setForm((prev) => ({ ...prev, rekening: '', npwp: '', ptkp: '', no_bpjs_k: '', no_bpjs_tk: '' }));
      }
    } finally {
      setLoadingDefaults(false);
    }
    if (form.periode) loadPenalty(employeeId, form.periode);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[1000] flex items-start justify-center overflow-y-auto py-10 px-4" onClick={handleModalBackdrop}>
      <div className="bg-white w-full max-w-[720px] p-8" onClick={(e) => e.stopPropagation()}>
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
            <ReadOnlyField label="Rekening" value={form.rekening} />
          </div>

          {/* Data pajak & BPJS — Task 25: SEMUA ini standing data dari employees_master,
              tidak lagi diinput manual di sini. Kalau kosong/salah, update di Payroll Manager. */}
          <div>
            <p className="text-xs font-medium tracking-[0.04em] text-black border-b border-[#E0E0E0] pb-2 mb-3">
              DATA PAJAK &amp; BPJS
            </p>
            <div className="grid grid-cols-2 gap-4">
              <ReadOnlyField label="NPWP" value={form.npwp} />
              <ReadOnlyField label="PTKP" value={PTKP_DATA[form.ptkp]?.label} />
              <ReadOnlyField label="Nomor BPJS Kesehatan" value={form.no_bpjs_k} />
              <ReadOnlyField label="Nomor BPJS Ketenagakerjaan" value={form.no_bpjs_tk} />
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
              <NumberField
                label="Overtime (Lembur)"
                value={form.lembur}
                onChange={(val) => recalcFromPendapatan({ lembur: val })}
              />
              <NumberField
                label="Incentive"
                value={form.insentif}
                onChange={(val) => recalcFromPendapatan({ insentif: val })}
              />
              <NumberField
                label="Compensation Fund / Festive Allowance"
                value={form.kompensasi}
                onChange={(val) => recalcFromPendapatan({ kompensasi: val })}
              />
              <NumberField
                label="Allowance (Transport/Travel/Communication)"
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
            {!form.ptkp && (
              <p className="text-[11px] text-madael-red mb-2">
                PPh21 belum bisa dihitung — Status PTKP karyawan ini belum diisi di Payroll Manager. Isi dulu di sana, lalu buat ulang slip ini.
              </p>
            )}
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
