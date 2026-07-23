'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { History } from 'lucide-react';
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

function DetailCell({ detail }) {
  const [open, setOpen] = useState(false);
  if (!detail) return <span className="text-[#C9C9C9]">—</span>;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-madael-red hover:text-madael-dark cursor-pointer"
      >
        {open ? 'Sembunyikan' : 'Lihat detail'}
      </button>
      {open && (
        <pre className="mt-2 text-[10px] leading-relaxed bg-[#F4F4F4] p-2 max-w-[360px] overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
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
    return logs.filter((l) => {
      if (userFilter !== 'all' && l.user_id !== userFilter) return false;
      if (aksiFilter !== 'all' && l.aksi !== aksiFilter) return false;
      return true;
    });
  }, [logs, userFilter, aksiFilter]);

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
          className="border border-[#E0E0E0] px-3 py-2 text-sm"
        />
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="border border-[#E0E0E0] px-3 py-2 text-sm"
        >
          <option value="all">Semua User</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.nama}</option>
          ))}
        </select>
        <select
          value={aksiFilter}
          onChange={(e) => setAksiFilter(e.target.value)}
          className="border border-[#E0E0E0] px-3 py-2 text-sm"
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
                <th className="px-4 py-3 font-medium">Waktu</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Aksi</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((log) => (
                <tr key={log.id} className="border-b border-[#F4F4F4] last:border-0 align-top">
                  <td className="px-4 py-3 whitespace-nowrap text-[#6B6B6B]">{formatWaktu(log.created_at)}</td>
                  <td className="px-4 py-3">{empById[log.user_id]?.nama || '—'}</td>
                  <td className="px-4 py-3">{AKSI_LABEL[log.aksi] || log.aksi}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">
                    {log.target_table || '—'}
                    {log.target_id && <span className="text-[#C9C9C9]"> · {String(log.target_id).slice(0, 8)}</span>}
                  </td>
                  <td className="px-4 py-3"><DetailCell detail={log.detail} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
