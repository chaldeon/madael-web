'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModalDismiss } from '@/lib/useModalDismiss';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import { friendlyError } from '@/lib/errorMessage';
import { fetchAllRows } from '@/lib/fetchAllRows';

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const STATUS_STYLE = {
  Draft: 'bg-[#F3F4F6] text-[#4B5563]',
  Review: 'bg-amber-100 text-amber-800',
  Approved: 'bg-[#DCFCE7] text-[#166534]',
};

// Kolom yang bisa disortir — pola sama seperti app/employee/list. ctx berisi
// runs dan employeeCounts untuk resolve status/jumlah per klien.
const SORT_COLUMNS = {
  klien: { get: (client) => (client.nama_perusahaan || '').toLowerCase() },
  jumlah: { get: (client, ctx) => ctx.employeeCounts[client.id] || 0 },
  status: { get: (client, ctx) => ctx.runs[client.id]?.status || '' },
};

function SortableHeader({ colKey, label, sortField, sortDir, onSort }) {
  const active = sortField === colKey;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className="px-4 py-3 font-medium">
      <button
        type="button"
        onClick={() => onSort(colKey)}
        className={`flex items-center gap-1.5 hover:text-black transition-colors ${active ? 'text-black' : ''}`}
      >
        {label}
        <Icon size={12} className={active ? 'text-madael-red' : 'text-[#B0B0B0]'} />
      </button>
    </th>
  );
}

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
  const [sortField, setSortField] = useState('klien');
  const [sortDir, setSortDir] = useState('asc');

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setCreateError(null);

    // companies & employees_master dimuat lewat fetchAllRows: tanpa itu respons
    // terpotong di 1.000 baris dan jumlah employee per klien mengecil diam-diam.
    const [clRes, runRes, empRes] = await Promise.all([
      fetchAllRows(() => supabase.from('companies').select('id, nama_perusahaan').order('nama_perusahaan')),
      supabase.from('payroll_runs').select('*').eq('periode', periode),
      fetchAllRows(() => supabase.from('employees_master').select('id, client_id')),
    ]);

    const firstError = clRes.error || runRes.error || empRes.error;
    if (firstError) {
      setLoadError(friendlyError(firstError, 'Gagal memuat data payroll run.'));
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

  const [pendingDraft, setPendingDraft] = useState(null); // { client, skippedNames }
  const handlePendingDraftBackdrop = useModalDismiss(!!pendingDraft, () => setPendingDraft(null), false);

  // Pembuatan run + snapshot dikerjakan server (POST /api/payroll/runs): server
  // yang menghitung angka, menolak run ganda (klien + periode), dan membatalkan
  // run kalau item gagal tersimpan. Employee dengan akun absensi Nonaktif
  // dilewati hanya setelah admin mengonfirmasi di modal ringkasan: server
  // membalas 409 NONAKTIF_PERLU_KONFIRMASI, lalu permintaan dikirim ulang dengan
  // lewati_nonaktif = true.
  const requestDraft = async (client, lewatiNonaktif) => {
    setCreatingClientId(client.id);
    setCreateError(null);

    try {
      const res = await fetch('/api/payroll/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, periode, lewati_nonaktif: lewatiNonaktif }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.ok && json.run?.id) {
        router.push(`/employee/payroll/run/${json.run.id}`);
        return;
      }

      setCreatingClientId(null);
      if (res.status === 409 && json.code === 'NONAKTIF_PERLU_KONFIRMASI') {
        setPendingDraft({ client, skippedNames: json.dilewati || [] });
        return;
      }
      setCreateError(json.error || 'Gagal membuat payroll run.');
      // Run sudah dibuat admin lain: muat ulang supaya tombol Detail muncul.
      if (json.code === 'RUN_SUDAH_ADA') await loadData();
    } catch (err) {
      console.error('Buat draft payroll run error:', err);
      setCreatingClientId(null);
      setCreateError('Gagal membuat payroll run. Periksa koneksi lalu coba lagi.');
    }
  };

  const handleBuatDraft = (client) => requestDraft(client, false);

  const sortedClients = useMemo(() => {
    const ctx = { runs, employeeCounts };
    const getValue = SORT_COLUMNS[sortField]?.get;
    if (!getValue) return clients;

    const sorted = [...clients].sort((a, b) => {
      const va = getValue(a, ctx);
      const vb = getValue(b, ctx);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [clients, runs, employeeCounts, sortField, sortDir]);

  const handleSort = (colKey) => {
    if (sortField === colKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(colKey);
      setSortDir('asc');
    }
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
                <SortableHeader colKey="klien" label="Klien" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="jumlah" label="Jumlah Employee" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sortedClients.map((client) => {
                const run = runs[client.id];
                const count = employeeCounts[client.id] || 0;
                return (
                  <tr key={client.id} className="border-b border-[#E0E0E0] last:border-0">
                    <td className="px-4 py-3 text-black">{client.nama_perusahaan}</td>
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

      {pendingDraft && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4" onClick={handlePendingDraftBackdrop}>
          <div className="bg-white w-full max-w-[480px] p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-black mb-3">Sebagian employee akan dilewati</h2>
            <p className="text-sm text-[#6B6B6B] mb-3">
              {pendingDraft.skippedNames.length} employee dilewati karena akun absensinya Nonaktif:
            </p>
            <ul className="text-sm text-black list-disc list-inside mb-4 max-h-40 overflow-y-auto">
              {pendingDraft.skippedNames.map((nama, idx) => (
                <li key={idx}>{nama}</li>
              ))}
            </ul>
            <p className="text-xs text-[#9A9A9A] mb-5">
              Employee ini tidak akan ikut masuk ke draft payroll run untuk periode ini. Sisa employee lain tetap diproses seperti biasa.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setPendingDraft(null)}
                className="px-4 py-2 text-sm text-[#6B6B6B] hover:text-black transition-colors"
              >
                Batal
              </button>
              <button
                onClick={() => {
                  const { client } = pendingDraft;
                  setPendingDraft(null);
                  requestDraft(client, true);
                }}
                className="bg-madael-red text-white px-4 py-2 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors"
              >
                Lanjutkan Buat Draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}