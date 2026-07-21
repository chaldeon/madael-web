'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { computeSnapshot } from '@/lib/payroll/runSnapshot';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const STATUS_STYLE = {
  Draft: 'bg-[#F3F4F6] text-[#4B5563]',
  Review: 'bg-amber-100 text-amber-800',
  Approved: 'bg-[#DCFCE7] text-[#166534]',
};

export default function PayrollRunListPage() {
  const supabase = createClient();
  const router = useRouter();

  const [periode, setPeriode] = useState(currentMonthValue());
  const [clients, setClients] = useState([]);
  const [runs, setRuns] = useState({}); // client_id -> run row
  const [employeeCounts, setEmployeeCounts] = useState({}); // client_id -> count
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [creatingClientId, setCreatingClientId] = useState(null);
  const [createError, setCreateError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setCreateError(null);

    const [clRes, runRes, empRes] = await Promise.all([
      supabase.from('payroll_clients').select('id, nama_klien').order('nama_klien'),
      supabase.from('payroll_runs').select('*').eq('periode', periode),
      supabase.from('employees_master').select('id, client_id'),
    ]);

    const firstError = clRes.error || runRes.error || empRes.error;
    if (firstError) {
      setLoadError(firstError.message || 'Gagal memuat data payroll run.');
      setLoading(false);
      return;
    }

    setClients(clRes.data || []);

    const byClient = {};
    (runRes.data || []).forEach((r) => { byClient[r.client_id] = r; });
    setRuns(byClient);

    const counts = {};
    (empRes.data || []).forEach((e) => {
      if (!e.client_id) return;
      counts[e.client_id] = (counts[e.client_id] || 0) + 1;
    });
    setEmployeeCounts(counts);

    setLoading(false);
  }, [supabase, periode]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleBuatDraft = async (client) => {
    setCreatingClientId(client.id);
    setCreateError(null);

    const { data: emps, error: empError } = await supabase
      .from('employees_master')
      .select('id, gaji_pokok, tunjangan, komponen_lain, linked_employee_id, status_ptkp, jkk_rate')
      .eq('client_id', client.id);

    if (empError) {
      setCreatingClientId(null);
      setCreateError(`Gagal memuat employee klien "${client.nama_klien}": ${empError.message}`);
      return;
    }

    if (!emps || emps.length === 0) {
      setCreatingClientId(null);
      setCreateError(`Klien "${client.nama_klien}" belum punya employee di Payroll Manager.`);
      return;
    }

    const { data: run, error: runError } = await supabase
      .from('payroll_runs')
      .insert([{ client_id: client.id, periode, status: 'Draft' }])
      .select()
      .single();

    if (runError) {
      setCreatingClientId(null);
      setCreateError(`Gagal membuat payroll run: ${runError.message}`);
      return;
    }

    const snapshots = await Promise.all(emps.map((e) => computeSnapshot(supabase, e, periode)));
    const itemsPayload = snapshots.map((s) => ({ ...s, payroll_run_id: run.id }));

    const { error: itemsError } = await supabase.from('payroll_run_items').insert(itemsPayload);
    setCreatingClientId(null);

    if (itemsError) {
      setCreateError(`Run dibuat tapi gagal hitung item: ${itemsError.message}. Buka Detail untuk cek manual.`);
    }

    router.push(`/employee/payroll/run/${run.id}`);
  };

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  if (loadError) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Payroll Run</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">
          Approval per periode per klien — Draft → Review → Approved.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="month"
          value={periode}
          onChange={(e) => setPeriode(e.target.value)}
          className={selectClass}
        />
      </div>

      {createError && (
        <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 mb-6">
          <span>{createError}</span>
          <button onClick={() => setCreateError(null)} className="shrink-0 hover:text-red-900">✕</button>
        </div>
      )}

      {loading ? (
        <LoadingState label="Memuat data klien..." />
      ) : clients.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Belum ada klien payroll. Tambahkan di Payroll Manager dulu." />
        </div>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Klien</th>
                <th className="px-4 py-3 font-medium">Jumlah Employee</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const run = runs[client.id];
                const count = employeeCounts[client.id] || 0;
                return (
                  <tr key={client.id} className="border-b border-[#E0E0E0] last:border-0">
                    <td className="px-4 py-3 text-black">{client.nama_klien}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{count}</td>
                    <td className="px-4 py-3">
                      {run ? (
                        <span className={`text-[11px] font-medium px-2.5 py-1 ${STATUS_STYLE[run.status] || STATUS_STYLE.Draft}`}>
                          {run.status}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#9A9A9A]">Belum dibuat</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {run ? (
                        <Link
                          href={`/employee/payroll/run/${run.id}`}
                          className="text-xs text-madael-red hover:text-madael-dark font-medium"
                        >
                          Detail →
                        </Link>
                      ) : (
                        <button
                          onClick={() => handleBuatDraft(client)}
                          disabled={creatingClientId === client.id || count === 0}
                          className="bg-madael-red text-white px-4 py-1.5 text-xs font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors disabled:opacity-40"
                        >
                          {creatingClientId === client.id ? 'Membuat...' : 'Buat Draft'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#6B6B6B] text-xs px-4 py-3 mt-6">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        "Buat Draft" menghitung ulang gaji, BPJS, PPh21, dan penalty semua employee klien ini untuk periode yang dipilih, lalu menyimpannya sebagai snapshot run. Kalau ada perubahan data employee setelah draft dibuat, snapshot ini TIDAK otomatis ikut berubah — hapus dan buat ulang run kalau perlu.
      </div>
    </div>
  );
}