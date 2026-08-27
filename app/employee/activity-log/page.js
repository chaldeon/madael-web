'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { History, ArrowUp, ArrowDown, ArrowUpDown, X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const AKSI_LABEL = {
  koreksi_absensi: 'Koreksi Absensi',
  koreksi_absensi_tambah: 'Tambah Record Absensi',
  approve_cuti: 'Approve Cuti',
  reject_cuti: 'Reject Cuti',
  ubah_status_payroll: 'Ubah Status Payroll',
  edit_struktur_gaji: 'Edit Struktur Gaji',
  tambah_employee_master: 'Tambah Employee Master',
};

function formatWaktu(value) {
  return new Date(value).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Kolom yang bisa disortir — pola sama seperti app/employee/list.
const SORT_COLUMNS = {
  waktu: { get: (l, empById) => new Date(l.created_at).getTime() },
  user: { get: (l, empById) => (empById[l.user_id]?.nama || '').toLowerCase() },
  aksi: { get: (l, empById) => (AKSI_LABEL[l.aksi] || l.aksi || '').toLowerCase() },
  target: { get: (l, empById) => (l.target_table || '').toLowerCase() },
};

// Header kolom tabel yang bisa diklik buat sortir — sama seperti di Employee List.
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

// Tombol pemicu modal detail — tabel tidak lagi berubah tinggi baris
// apapun yang diklik, karena isi JSON ditampilkan di luar tabel (modal).
function DetailButton({ detail, onOpen }) {
  if (!detail) return <span className="text-[#C9C9C9]">—</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-xs text-madael-red hover:text-madael-dark cursor-pointer"
    >
      Lihat detail
    </button>
  );
}

// Modal detail — satu row dilihat dalam satu waktu (bukan expand inline
// per baris), supaya layout tabel tetap stabil dan ruang JSON lebih lega.
function DetailModal({ log, aksiLabel, empNama, onClose }) {
  if (!log) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] px-6">
      <div className="w-full max-w-[560px] bg-white border-t-4 border-madael-red p-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-[20px] font-normal text-black">Detail Aktivitas</h2>
          <button onClick={onClose} className="text-[#6B6B6B] hover:text-black">
            <X size={20} />
          </button>
        </div>

        <dl className="grid grid-cols-[100px_1fr] gap-y-2 text-sm mb-6">
          <dt className="text-[#6B6B6B]">Waktu</dt>
          <dd className="text-black">{formatWaktu(log.created_at)}</dd>
          <dt className="text-[#6B6B6B]">User</dt>
          <dd className="text-black">{empNama || '—'}</dd>
          <dt className="text-[#6B6B6B]">Aksi</dt>
          <dd className="text-black">{aksiLabel}</dd>
          <dt className="text-[#6B6B6B]">Target</dt>
          <dd className="text-black">
            {log.target_table || '—'}
            {log.target_id && <span className="text-[#9A9A9A]"> · {String(log.target_id).slice(0, 8)}</span>}
          </dd>
        </dl>

        <pre className="text-xs leading-relaxed text-black bg-[#F4F4F4] border border-[#E0E0E0] p-4 overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(log.detail, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export default function ActivityLogPage() {
  const supabase = createClient();

  const [monthValue, setMonthValue] = useState(currentMonthValue());
  const [userFilter, setUserFilter] = useState('all');
  const [aksiFilter, setAksiFilter] = useState('all');
  const [employees, setEmployees] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [sortField, setSortField] = useState('waktu');
  const [sortDir, setSortDir] = useState('desc');

  const [detailLog, setDetailLog] = useState(null); // row yang sedang dibuka di modal detail

  const handleSort = (colKey) => {
    if (sortField === colKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(colKey);
      setSortDir('asc');
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const [year, month] = monthValue.split('-').map(Number);
    const firstDay = new Date(year, month - 1, 1).toISOString();
    const lastDay = new Date(year, month, 1).toISOString();

    const [empRes, logRes] = await Promise.all([
      supabase.from('employees').select('id, nama').order('nama'),
      supabase
        .from('activity_logs')
        .select('id, user_id, aksi, target_table, target_id, detail, created_at')
        .gte('created_at', firstDay)
        .lt('created_at', lastDay)
        .order('created_at', { ascending: false }),
    ]);

    const firstError = empRes.error || logRes.error;
    if (firstError) {
      setLoadError(firstError.message || 'Gagal memuat activity log.');
      setLoading(false);
      return;
    }

    setEmployees(empRes.data || []);
    setLogs(logRes.data || []);
    setLoading(false);
  }, [supabase, monthValue]);

  useEffect(() => { loadData(); }, [loadData]);

  const empById = useMemo(() => {
    const map = {};
    employees.forEach((e) => { map[e.id] = e; });
    return map;
  }, [employees]);

  const aksiOptions = useMemo(() => {
    const set = new Set(logs.map((l) => l.aksi));
    return Array.from(set);
  }, [logs]);

  const rows = useMemo(() => {
    const filtered = logs.filter((l) => {
      if (userFilter !== 'all' && l.user_id !== userFilter) return false;
      if (aksiFilter !== 'all' && l.aksi !== aksiFilter) return false;
      return true;
    });

    const getValue = SORT_COLUMNS[sortField]?.get;
    if (!getValue) return filtered;

    const sorted = [...filtered].sort((a, b) => {
      const va = getValue(a, empById);
      const vb = getValue(b, empById);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [logs, userFilter, aksiFilter, sortField, sortDir, empById]);

  if (loading) {
    return (
      <div className="max-w-[1100px] mx-auto px-10 py-16">
        <LoadingState label="Memuat activity log..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[1100px] mx-auto px-10 py-16">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto px-10 py-10">
      <div className="flex items-center gap-2 mb-1">
        <History size={18} className="text-madael-red" />
        <h1 className="text-2xl font-semibold text-black">Activity Log</h1>
      </div>
      <p className="text-sm text-[#6B6B6B] mb-8">
        Audit trail untuk koreksi absensi, approve/reject cuti, perubahan status payroll, dan edit struktur gaji.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="month"
          value={monthValue}
          onChange={(e) => setMonthValue(e.target.value)}
          className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
        />
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
        >
          <option value="all">Semua User</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.nama}</option>
          ))}
        </select>
        <select
          value={aksiFilter}
          onChange={(e) => setAksiFilter(e.target.value)}
          className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
        >
          <option value="all">Semua Aksi</option>
          {aksiOptions.map((a) => (
            <option key={a} value={a}>{AKSI_LABEL[a] || a}</option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="Tidak ada aktivitas pada periode/filter ini." icon={History} />
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B] uppercase tracking-[0.04em]">
                <SortableHeader colKey="waktu" label="Waktu" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="user" label="User" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="aksi" label="Aksi" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="target" label="Target" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((log) => (
                <tr key={log.id} className="border-b border-[#F4F4F4] last:border-0 align-top">
                  <td className="px-4 py-3 whitespace-nowrap text-[#6B6B6B]">{formatWaktu(log.created_at)}</td>
                  <td className="px-4 py-3 text-black">{empById[log.user_id]?.nama || '—'}</td>
                  <td className="px-4 py-3 text-black">{AKSI_LABEL[log.aksi] || log.aksi}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">
                    {log.target_table || '—'}
                    {log.target_id && <span className="text-[#C9C9C9]"> · {String(log.target_id).slice(0, 8)}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <DetailButton detail={log.detail} onOpen={() => setDetailLog(log)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DetailModal
        log={detailLog}
        aksiLabel={detailLog ? (AKSI_LABEL[detailLog.aksi] || detailLog.aksi) : ''}
        empNama={detailLog ? empById[detailLog.user_id]?.nama : ''}
        onClose={() => setDetailLog(null)}
      />
    </div>
  );
}