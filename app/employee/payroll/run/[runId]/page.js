'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { hitungBPJS, hitungBrutoPPh21, hitungPPh21TER } from '@/lib/payroll/calculations';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { notifyEmployees } from '@/lib/notify';
import { logActivity } from '@/lib/activityLog';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import { computeSnapshot } from '@/lib/payroll/runSnapshot';

const STATUS_OPTIONS = ['Draft', 'Review', 'Approved'];
const STATUS_STYLE = {
  Draft: 'bg-[#F3F4F6] text-[#4B5563]',
  Review: 'bg-amber-100 text-amber-800',
  Approved: 'bg-[#DCFCE7] text-[#166534]',
};

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function periodeLabel(periode) {
  const [year, month] = (periode || '').split('-').map(Number);
  const nama = MONTH_NAMES[(month || 1) - 1];
  return nama ? `${nama} ${year}` : periode;
}

function formatRupiah(value) {
  return 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
}

// Sama seperti di employee/payroll (NumberField) — dipakai buat tampilkan
// pemisah ribuan titik di input Overtime/Insentif/Kompensasi.
function formatNumberDisplay(value) {
  if (value === '' || value === null || value === undefined) return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  return num.toLocaleString('id-ID');
}

// CSV manual, sama pendekatannya dengan Export rekap absensi (Task 12) — tanpa
// dependency tambahan. Kolom generik dulu (nama rekening, no rekening,
// nominal); format detail perlu dikonfirmasi Daniel sesuai bank tujuan.
function toCsvValue(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function downloadTransferCsv(items, periode) {
  const header = ['Nama Karyawan', 'Nama Rekening', 'No Rekening', 'Nominal'];
  const lines = [header.map(toCsvValue).join(',')];
  items.forEach((item) => {
    lines.push([
      item.employees_master?.nama || '',
      item.employees_master?.nama_rekening || '',
      item.employees_master?.no_rekening || '',
      item.take_home_pay,
    ].map(toCsvValue).join(','));
  });
  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transfer-payroll-${periode}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function PayrollRunDetailPage() {
  const { runId } = useParams();
  const supabase = createClient();
  const { status, employee } = useModuleAccess('payroll');

  const [run, setRun] = useState(null);
  const [client, setClient] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [statusDraft, setStatusDraft] = useState('Draft');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [generateNote, setGenerateNote] = useState(null);
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const { data: runData, error: runError } = await supabase
      .from('payroll_runs')
      .select('*, companies ( id, nama_perusahaan )')
      .eq('id', runId)
      .maybeSingle();

    if (runError || !runData) {
      setLoadError(runError?.message || 'Payroll run tidak ditemukan.');
      setLoading(false);
      return;
    }

    setRun(runData);
    setClient(runData.companies);
    setStatusDraft(runData.status);

    const { data: itemsData, error: itemsError } = await supabase
      .from('payroll_run_items')
      .select('*, employees_master ( id, nama, posisi, linked_employee_id, nama_rekening, no_rekening, jkk_rate, status_ptkp )')
      .eq('payroll_run_id', runId);

    if (itemsError) {
      setLoadError(itemsError.message || 'Gagal memuat item payroll run.');
      setLoading(false);
      return;
    }

    setItems(itemsData || []);
    setLoading(false);
  }, [supabase, runId]);

  useEffect(() => {
    if (status === 'allowed') loadData();
  }, [status, loadData]);

  // Employee baru yang ditambahkan di Payroll Manager SETELAH run ini dibuat
  // tidak otomatis masuk sini — payroll_run_items itu snapshot sekali jalan
  // waktu "Buat Draft" ditekan. Fungsi ini bandingkan employees_master klien
  // dengan item yang sudah ada di run, lalu insert item baru (pakai
  // computeSnapshot yang sama dengan waktu run dibuat) buat yang belum ada.
  // Cuma untuk run yang belum Approved — run yang sudah final tidak diubah.
  const handleSyncEmployeeBaru = async () => {
    setSyncing(true);
    setSyncNote(null);
    setLoadError(null);

    const { data: emps, error: empError } = await supabase
      .from('employees_master')
      .select('id, gaji_pokok, tunjangan, komponen_lain, linked_employee_id, status_ptkp, jkk_rate')
      .eq('client_id', run.client_id);

    if (empError) {
      setSyncing(false);
      setLoadError(`Gagal cek employee baru: ${empError.message}`);
      return;
    }

    const existingIds = new Set(items.map((i) => i.employee_master_id));
    const newEmps = (emps || []).filter((e) => !existingIds.has(e.id));

    if (newEmps.length === 0) {
      setSyncing(false);
      setSyncNote('Tidak ada employee baru — semua employee klien ini sudah ada di run ini.');
      return;
    }

    const snapshots = await Promise.all(newEmps.map((e) => computeSnapshot(supabase, e, run.periode)));
    const itemsPayload = snapshots.map((s) => ({ ...s, payroll_run_id: run.id }));

    const { error: insertError } = await supabase.from('payroll_run_items').insert(itemsPayload);
    setSyncing(false);

    if (insertError) {
      setLoadError(`Gagal tambah employee baru ke run: ${insertError.message}`);
      return;
    }

    setSyncNote(`${newEmps.length} employee baru berhasil ditambahkan ke run ini.`);
    await loadData();
  };

  // Draft input Overtime/Insentif/Kompensasi per item, sebelum di-"Hitung Ulang"
  // & disimpan. Key: item.id.
  const [editValues, setEditValues] = useState({});
  const [recalcSaving, setRecalcSaving] = useState(null); // item.id yang lagi disimpan

  const getEditValue = (item, field) =>
    editValues[item.id]?.[field] ?? item[field] ?? 0;

  const setEditValue = (itemId, field, val) => {
    setEditValues((prev) => ({ ...prev, [itemId]: { ...prev[itemId], [field]: val } }));
  };

  // Hitung ulang PPh21/THP persis rumus yang sama dengan Payslip:
  // Bruto PPh21 = Gaji Pokok + Allowance + Overtime + Insentif + Kompensasi
  //             + JKK + JKM + BPJS Kesehatan (perusahaan) − Penalty
  const recalcAndSaveItem = async (item) => {
    const overtime = Number(getEditValue(item, 'overtime')) || 0;
    const insentif = Number(getEditValue(item, 'insentif')) || 0;
    const kompensasi = Number(getEditValue(item, 'kompensasi')) || 0;
    const master = item.employees_master;

    setRecalcSaving(item.id);

    const gajiPokok = Number(item.gaji_pokok) || 0;
    const totalForBruto = (Number(item.allowance) || 0) + overtime + insentif + kompensasi;
    const bpjs = master?.jkk_rate != null ? hitungBPJS(gajiPokok, master.jkk_rate) : null;
    const brutoPPh21 = bpjs ? hitungBrutoPPh21(gajiPokok, totalForBruto, bpjs, item.penalty) : null;
    const pph21Result = (bpjs && master?.status_ptkp) ? hitungPPh21TER(brutoPPh21, master.status_ptkp) : null;
    const pph21 = pph21Result ? Math.floor(pph21Result.pph) : 0;
    const bpjsEmployee = bpjs ? bpjs.totalEmployee : 0;
    const takeHomePay = gajiPokok + totalForBruto - (Number(item.penalty) || 0) - bpjsEmployee - pph21;

    const payload = {
      overtime,
      insentif,
      kompensasi,
      pph21,
      take_home_pay: Math.round(takeHomePay),
    };

    const { error } = await supabase.from('payroll_run_items').update(payload).eq('id', item.id);
    setRecalcSaving(null);
    if (error) {
      setLoadError(`Gagal simpan Overtime/Insentif/Kompensasi: ${error.message}`);
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...payload } : i)));
  };

  const totalThp = useMemo(() => items.reduce((sum, i) => sum + (Number(i.take_home_pay) || 0), 0), [items]);
  const missingRekening = useMemo(
    () => items.filter((i) => !i.employees_master?.nama_rekening || !i.employees_master?.no_rekening),
    [items]
  );
  const unlinkedCount = useMemo(
    () => items.filter((i) => !i.employees_master?.linked_employee_id).length,
    [items]
  );
  const hasIncomplete = useMemo(() => items.some((i) => i.incomplete), [items]);
  const approvingWithIssue = statusDraft === 'Approved' && run?.status !== 'Approved' && hasIncomplete;

  // Generate/update entry Payslip Portal untuk tiap item yang employee-nya
  // sudah terhubung ke akun Absensi (linked_employee_id). Item yang belum
  // terhubung dilewati — dilaporkan lewat generateNote, tidak menghentikan
  // proses untuk item lain.
  const generateSlips = async (currentItems, periode) => {
    let generated = 0;
    let skipped = 0;
    const errors = [];

    for (const item of currentItems) {
      const linkedId = item.employees_master?.linked_employee_id;
      if (!linkedId) { skipped += 1; continue; }

      // Cek slip yang sudah pernah dibuat run ini, atau slip manual yang
      // sudah ada untuk employee+periode ini — supaya klik Approved dua kali
      // tidak membuat slip dobel.
      let existingPayslipId = item.payslip_id;
      if (!existingPayslipId) {
        const { data: existing } = await supabase
          .from('payslips')
          .select('id')
          .eq('employee_id', linkedId)
          .eq('periode', periode)
          .maybeSingle();
        existingPayslipId = existing?.id || null;
      }

      const payload = {
        employee_id: linkedId,
        periode,
        periode_label: periodeLabel(periode),
        gaji_pokok: item.gaji_pokok,
        tunjangan_lain: item.allowance,
        lembur: item.overtime,
        insentif: item.insentif,
        kompensasi: item.kompensasi,
        jht_karyawan: 0,
        jp_karyawan: 0,
        bpjs_k_karyawan: 0,
        pph21: item.pph21,
        penalty: item.penalty,
        is_published: true,
      };
      // BPJS employee di atas disederhanakan jadi satu baris "allowance" +
      // pph21/penalty eksak dari snapshot; breakdown detail BPJS per komponen
      // (JHT/JP/Kesehatan) bisa dilengkapi manual di Kelola Slip Gaji kalau
      // Daniel butuh rincian itu tampil di slip cetak.

      if (existingPayslipId) {
        const { error } = await supabase.from('payslips').update(payload).eq('id', existingPayslipId);
        if (error) { errors.push(`${item.employees_master?.nama}: ${error.message}`); continue; }
      } else {
        const res = await fetch('/api/documents/generate-number', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kode_jenis: 'INV' }),
        });
        const numberData = await res.json();
        if (!res.ok) { errors.push(`${item.employees_master?.nama}: gagal generate nomor dokumen`); continue; }

        const { data: inserted, error } = await supabase
          .from('payslips')
          .insert([{ ...payload, nomor_dokumen: numberData.nomor_surat }])
          .select()
          .single();
        if (error) { errors.push(`${item.employees_master?.nama}: ${error.message}`); continue; }
        existingPayslipId = inserted.id;
      }

      await supabase.from('payroll_run_items').update({ payslip_id: existingPayslipId }).eq('id', item.id);
      generated += 1;
    }

    return { generated, skipped, errors };
  };

  const handleSaveStatus = async () => {
    setSaving(true);
    setSaveError(null);
    setGenerateNote(null);

    const wasApproved = run.status === 'Approved';
    const { data, error } = await supabase
      .from('payroll_runs')
      .update({ status: statusDraft, updated_by: employee.id, updated_at: new Date().toISOString() })
      .eq('id', runId)
      .select()
      .single();

    if (error) {
      setSaving(false);
      setSaveError(error.message || 'Gagal menyimpan status.');
      return;
    }
    setRun(data);

    logActivity(supabase, {
      userId: employee.id,
      aksi: 'ubah_status_payroll',
      targetTable: 'payroll_runs',
      targetId: runId,
      detail: { periode: run.periode, status_sebelum: run.status, status_sesudah: statusDraft },
    });

    if (statusDraft === 'Approved' && !wasApproved) {
      const result = await generateSlips(items, run.periode);
      const { data: refreshedItems } = await supabase
        .from('payroll_run_items')
        .select('*, employees_master ( id, nama, posisi, linked_employee_id, nama_rekening, no_rekening, jkk_rate, status_ptkp )')
        .eq('payroll_run_id', runId);
      setItems(refreshedItems || []);

      let note = `${result.generated} slip berhasil dibuat/diperbarui.`;
      if (result.skipped > 0) note += ` ${result.skipped} employee dilewati (belum terhubung ke akun Absensi).`;
      if (result.errors.length > 0) note += ` Error: ${result.errors.join('; ')}`;
      setGenerateNote(note);

      notifyEmployees(supabase, {
        userIds: (refreshedItems || [])
          .map((i) => i.employees_master?.linked_employee_id)
          .filter(Boolean),
        tipe: 'payroll_approved',
        pesan: `Payslip periode ${periodeLabel(run.periode)} sudah disetujui dan bisa dilihat.`,
        link: '/employee/payslip',
      });
    }

    setConfirmIncomplete(false);
    setSaving(false);
  };

  if (status === 'loading' || loading) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat payroll run..." />
      </section>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-10">
      <Link
        href="/employee/payroll/run"
        className="flex items-center gap-2 text-sm text-[#6B6B6B] hover:text-madael-red transition-colors mb-4 w-fit"
      >
        <ArrowLeft size={16} />
        Payroll Run
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-4 mb-8">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">
            {client?.nama_perusahaan || 'Klien'}
          </h1>
          <p className="text-sm text-[#6B6B6B] mt-1">{periodeLabel(run.periode)} · {items.length} employee</p>
        </div>
        <span className={`text-xs font-medium px-3 py-1.5 ${STATUS_STYLE[run.status] || STATUS_STYLE.Draft}`}>
          {run.status}
        </span>
      </div>

      <div className="bg-white border border-[#E0E0E0] p-5 mb-6 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[#6B6B6B]">Ubah Status</span>
          <select
            value={statusDraft}
            onChange={(e) => { setStatusDraft(e.target.value); setConfirmIncomplete(false); }}
            className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
          >
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button
          onClick={handleSaveStatus}
          disabled={saving || statusDraft === run.status || (approvingWithIssue && !confirmIncomplete)}
          className="bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors disabled:opacity-40"
        >
          {saving ? 'Menyimpan...' : 'Simpan Status'}
        </button>
        {run.status !== 'Approved' && (
          <button
            onClick={handleSyncEmployeeBaru}
            disabled={syncing}
            className="border border-[#E0E0E0] text-black px-5 py-2 text-sm font-medium tracking-[0.02em] hover:border-madael-red transition-colors disabled:opacity-40"
          >
            {syncing ? 'Mengecek...' : 'Sync Employee Baru'}
          </button>
        )}
        {run.status === 'Approved' && (
          <button
            onClick={() => downloadTransferCsv(items, run.periode)}
            className="bg-[#111827] text-white px-5 py-2 text-sm font-medium tracking-[0.02em] hover:bg-black transition-colors"
          >
            Export Transfer
          </button>
        )}
        <div className="ml-auto text-sm text-[#6B6B6B]">
          Total THP: <span className="text-black font-medium">{formatRupiah(totalThp)}</span>
        </div>
      </div>

      {approvingWithIssue && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 mb-6">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={confirmIncomplete}
              onChange={(e) => setConfirmIncomplete(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Beberapa employee di run ini punya PPh21/BPJS Rp0 karena data belum lengkap (lihat catatan di bawah tabel).
              Slip yang digenerate akan pakai angka Rp0 tersebut. Centang ini untuk tetap lanjut Approve.
            </span>
          </label>
        </div>
      )}

      {saveError && (
        <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 mb-6">
          <span>{saveError}</span>
        </div>
      )}

      {generateNote && (
        <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#3D3D3D] text-xs px-4 py-3 mb-6">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-madael-red" />
          {generateNote}
        </div>
      )}

      {syncNote && (
        <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#3D3D3D] text-xs px-4 py-3 mb-6">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-madael-red" />
          {syncNote}
        </div>
      )}

      {unlinkedCount > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-3 mb-6">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {unlinkedCount} employee belum terhubung ke akun Absensi — slip untuk mereka tidak bisa dibuat otomatis. Hubungkan lewat Payroll Manager (field "Akun Absensi"), lalu buat slip manual di Kelola Slip Gaji.
        </div>
      )}

      {missingRekening.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-3 mb-6">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {missingRekening.length} employee belum ada data rekening (Nama/No Rekening) — akan tetap muncul di Export Transfer dengan kolom kosong. Format kolom CSV ini masih generik, perlu dikonfirmasi Daniel sebelum dipakai transfer sungguhan.
        </div>
      )}

      {items.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Belum ada item di payroll run ini." />
        </div>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <p className="text-xs text-[#6B6B6B] px-4 pt-3">
            Isi Overtime/Insentif/Kompensasi per employee lalu klik "Hitung Ulang" untuk update PPh21 & THP — sama seperti di Kelola Slip Gaji.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Nama</th>
                <th className="px-4 py-3 font-medium">Posisi</th>
                <th className="px-4 py-3 font-medium text-right">Gaji Pokok</th>
                <th className="px-4 py-3 font-medium text-right">Allowance</th>
                <th className="px-4 py-3 font-medium text-right">Overtime</th>
                <th className="px-4 py-3 font-medium text-right">Insentif</th>
                <th className="px-4 py-3 font-medium text-right">Kompensasi</th>
                <th className="px-4 py-3 font-medium text-right">Penalty</th>
                <th className="px-4 py-3 font-medium text-right">PPh21</th>
                <th className="px-4 py-3 font-medium text-right">THP</th>
                <th className="px-4 py-3 font-medium">Slip</th>
                <th className="px-4 py-3 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-[#E0E0E0] last:border-0">
                  <td className="px-4 py-3 text-black">{item.employees_master?.nama || '—'}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{item.employees_master?.posisi || '—'}</td>
                  <td className="px-4 py-3 text-right text-[#6B6B6B]">{formatRupiah(item.gaji_pokok)}</td>
                  <td className="px-4 py-3 text-right text-[#6B6B6B]">{formatRupiah(item.allowance)}</td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={statusDraft === 'Approved'}
                      value={formatNumberDisplay(getEditValue(item, 'overtime'))}
                      onChange={(e) => setEditValue(item.id, 'overtime', e.target.value.replace(/[^\d]/g, ''))}
                      className="w-24 border border-[#E0E0E0] px-2 py-1 text-right text-sm text-black disabled:bg-[#F4F4F4] disabled:text-[#9A9A9A]"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={statusDraft === 'Approved'}
                      value={formatNumberDisplay(getEditValue(item, 'insentif'))}
                      onChange={(e) => setEditValue(item.id, 'insentif', e.target.value.replace(/[^\d]/g, ''))}
                      className="w-24 border border-[#E0E0E0] px-2 py-1 text-right text-sm text-black disabled:bg-[#F4F4F4] disabled:text-[#9A9A9A]"
                    />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={statusDraft === 'Approved'}
                      value={formatNumberDisplay(getEditValue(item, 'kompensasi'))}
                      onChange={(e) => setEditValue(item.id, 'kompensasi', e.target.value.replace(/[^\d]/g, ''))}
                      className="w-24 border border-[#E0E0E0] px-2 py-1 text-right text-sm text-black disabled:bg-[#F4F4F4] disabled:text-[#9A9A9A]"
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-[#6B6B6B]">{formatRupiah(item.penalty)}</td>
                  <td className="px-4 py-3 text-right text-[#6B6B6B]">{formatRupiah(item.pph21)}</td>
                  <td className="px-4 py-3 text-right text-black font-medium">{formatRupiah(item.take_home_pay)}</td>
                  <td className="px-4 py-3">
                    {item.payslip_id ? (
                      <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-[#DCFCE7] text-[#166534]">
                        SUDAH ADA
                      </span>
                    ) : (
                      <span className="text-[10px] text-[#9A9A9A]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      disabled={statusDraft === 'Approved' || recalcSaving === item.id}
                      onClick={() => recalcAndSaveItem(item)}
                      className="text-xs text-madael-red hover:text-madael-dark font-medium disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {recalcSaving === item.id ? 'Menghitung...' : 'Hitung Ulang'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.some((i) => i.incomplete) && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-3 mt-6">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Beberapa employee di run ini punya PPh21/BPJS Rp0 karena PTKP atau Tingkat Risiko JKK belum diisi saat draft dibuat — lengkapi di Payroll Manager, lalu buat ulang run kalau perlu angka yang benar.
        </div>
      )}
    </div>
  );
}