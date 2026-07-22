'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

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

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const { data: runData, error: runError } = await supabase
      .from('payroll_runs')
      .select('*, payroll_clients ( id, nama_klien )')
      .eq('id', runId)
      .maybeSingle();

    if (runError || !runData) {
      setLoadError(runError?.message || 'Payroll run tidak ditemukan.');
      setLoading(false);
      return;
    }

    setRun(runData);
    setClient(runData.payroll_clients);
    setStatusDraft(runData.status);

    const { data: itemsData, error: itemsError } = await supabase
      .from('payroll_run_items')
      .select('*, employees_master ( id, nama, posisi, linked_employee_id, nama_rekening, no_rekening )')
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
        tunjangan_transport: item.allowance,
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

    if (statusDraft === 'Approved' && !wasApproved) {
      const result = await generateSlips(items, run.periode);
      const { data: refreshedItems } = await supabase
        .from('payroll_run_items')
        .select('*, employees_master ( id, nama, posisi, linked_employee_id, nama_rekening, no_rekening )')
        .eq('payroll_run_id', runId);
      setItems(refreshedItems || []);

      let note = `${result.generated} slip berhasil dibuat/diperbarui.`;
      if (result.skipped > 0) note += ` ${result.skipped} employee dilewati (belum terhubung ke akun Absensi).`;
      if (result.errors.length > 0) note += ` Error: ${result.errors.join('; ')}`;
      setGenerateNote(note);
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
            {client?.nama_klien || 'Klien'}
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Nama</th>
                <th className="px-4 py-3 font-medium">Posisi</th>
                <th className="px-4 py-3 font-medium text-right">Gaji Pokok</th>
                <th className="px-4 py-3 font-medium text-right">Allowance</th>
                <th className="px-4 py-3 font-medium text-right">Penalty</th>
                <th className="px-4 py-3 font-medium text-right">PPh21</th>
                <th className="px-4 py-3 font-medium text-right">THP</th>
                <th className="px-4 py-3 font-medium">Slip</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-[#E0E0E0] last:border-0">
                  <td className="px-4 py-3 text-black">{item.employees_master?.nama || '—'}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{item.employees_master?.posisi || '—'}</td>
                  <td className="px-4 py-3 text-right text-[#6B6B6B]">{formatRupiah(item.gaji_pokok)}</td>
                  <td className="px-4 py-3 text-right text-[#6B6B6B]">{formatRupiah(item.allowance)}</td>
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