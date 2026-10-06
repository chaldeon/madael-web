'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Check, X as XIcon, RotateCcw, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { hitungHariKerja, hitungSisaCuti, labelJenisCuti, potongKuota } from '@/lib/leave';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function StatusBadge({ status }) {
  const map = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    cancelled: 'bg-[#F4F4F4] text-[#6B6B6B]',
  };
  const label = { pending: 'MENUNGGU', approved: 'DISETUJUI', rejected: 'DITOLAK', cancelled: 'DIBATALKAN' };
  return (
    <span className={`text-[10px] font-medium tracking-[0.04em] px-2 py-1 ${map[status] || 'bg-[#F4F4F4] text-[#6B6B6B]'}`}>
      {label[status] || status?.toUpperCase()}
    </span>
  );
}

// Kolom yang bisa disortir — pola sama seperti app/employee/list. ctx berisi
// map turunan (empById, hariKerjaByEmpId, masterByEmpId) yang dibutuhkan
// untuk menghitung Hari Kerja dan Sisa Kuota per baris.
const SORT_COLUMNS = {
  nama: { get: (r, ctx) => (ctx.empById[r.employee_id]?.nama || '').toLowerCase() },
  periode: { get: (r) => r.tanggal_mulai || '' },
  hari_kerja: { get: (r, ctx) => hitungHariKerja(r.tanggal_mulai, r.tanggal_selesai, ctx.hariKerjaByEmpId[r.employee_id]) },
  sisa_kuota: {
    get: (r, ctx) => {
      const sisa = hitungSisaCuti(ctx.masterByEmpId[r.employee_id]);
      return sisa ? sisa.sisa : -1;
    },
  },
  status: { get: (r) => r.status || '' },
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

export default function LeaveRequestAdminPage() {
  const { status } = useModuleAccess('leave_request_admin');

  const [statusFilter, setStatusFilter] = useState('pending');
  const [sortField, setSortField] = useState('periode');
  const [sortDir, setSortDir] = useState('desc');
  const [employees, setEmployees] = useState([]);
  const [requests, setRequests] = useState([]);
  const [schedules, setSchedules] = useState([]); // work_schedule rows
  const [masterList, setMasterList] = useState([]); // employees_master rows (kolom kuota saja)
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionWarning, setActionWarning] = useState(null);

  // Data dimuat lewat route server (bukan query browser) karena employees_master
  // dibatasi RLS superadmin — lihat catatan di app/api/leave-requests/admin.
  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const res = await fetch('/api/leave-requests/admin');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(json.error || 'Gagal memuat data pengajuan cuti.');
        return;
      }

      setEmployees(json.employees || []);
      setRequests(json.requests || []);
      setSchedules(json.schedules || []);
      setMasterList(json.master || []);
    } catch {
      setLoadError('Gagal memuat data pengajuan cuti. Periksa koneksi internet kamu.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'allowed') loadData();
  }, [status, loadData]);

  const empById = useMemo(() => {
    const map = {};
    employees.forEach((e) => { map[e.id] = e; });
    return map;
  }, [employees]);

  // employee_id (akun portal) -> hari_kerja
  const hariKerjaByEmpId = useMemo(() => {
    const map = {};
    schedules.forEach((s) => { map[s.employee_id] = s.hari_kerja; });
    return map;
  }, [schedules]);

  // employee_id (akun portal) -> row employees_master, lewat linked_employee_id.
  // Employee yang belum di-link (linked_employee_id null) sengaja tidak masuk map ini.
  const masterByEmpId = useMemo(() => {
    const map = {};
    masterList.forEach((m) => { if (m.linked_employee_id) map[m.linked_employee_id] = m; });
    return map;
  }, [masterList]);

  const rows = useMemo(() => {
    const filtered = statusFilter === 'all' ? requests : requests.filter((r) => r.status === statusFilter);

    const ctx = { empById, hariKerjaByEmpId, masterByEmpId };
    const getValue = SORT_COLUMNS[sortField]?.get;
    if (!getValue) return filtered;

    const sorted = [...filtered].sort((a, b) => {
      const va = getValue(a, ctx);
      const vb = getValue(b, ctx);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [requests, statusFilter, sortField, sortDir, empById, hariKerjaByEmpId, masterByEmpId]);

  const handleSort = (colKey) => {
    if (sortField === colKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(colKey);
      setSortDir('asc');
    }
  };

  // Semua perubahan (status + kuota + notifikasi + audit log) diproses atomik
  // di server lewat /api/leave-requests/[id]/decision. decision:
  // 'approved' | 'rejected' | 'cancelled' (batalkan cuti yang sudah disetujui).
  const handleDecision = async (row, decision) => {
    if (decision === 'cancelled') {
      const konfirmasi = window.confirm(
        `Batalkan ${potongKuota(row.jenis) ? 'cuti' : labelJenisCuti(row.jenis).toLowerCase()} yang sudah disetujui (${formatTanggal(row.tanggal_mulai)} — ${formatTanggal(row.tanggal_selesai)})?${potongKuota(row.jenis) ? '\n\nKuota cuti karyawan akan dikembalikan.' : ''}`
      );
      if (!konfirmasi) return;
    }

    setActionError(null);
    setActionWarning(null);
    setActingId(row.id);

    try {
      const res = await fetch(`/api/leave-requests/${row.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setActionError(json.error || 'Gagal memperbarui status pengajuan.');
        if (res.status === 409) loadData(); // status/kuota berubah di sisi lain — sinkronkan layar
        return;
      }

      setRequests((prev) => prev.map((r) => (r.id === json.request.id ? json.request : r)));
      if (json.kuota) {
        setMasterList((prev) => prev.map((m) => (
          m.id === json.kuota.master_id
            ? { ...m, cuti_terpakai: json.kuota.cuti_terpakai, cuti_terpakai_tahun: json.kuota.cuti_terpakai_tahun }
            : m
        )));
      }
      setActionWarning(json.warning || null);
    } catch {
      setActionError('Gagal memproses pengajuan. Periksa koneksi internet kamu.');
    } finally {
      setActingId(null);
    }
  };

  if (status === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat data..." />
      </section>
    );
  }

  if (status === 'denied') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Kamu tidak punya akses ke halaman ini.</p>
          <Link
            href="/employee/leave-request"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali
          </Link>
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Kelola Pengajuan Cuti</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">Tinjau dan setujui/tolak pengajuan cuti karyawan. Hari dihitung dari jadwal kerja masing-masing employee.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectClass}>
          <option value="pending">Menunggu</option>
          <option value="approved">Disetujui</option>
          <option value="rejected">Ditolak</option>
          <option value="cancelled">Dibatalkan</option>
          <option value="all">Semua</option>
        </select>
      </div>

      {actionError && <p className="text-xs text-red-600 mb-4">{actionError}</p>}
      {actionWarning && <p className="text-xs text-amber-700 mb-4">{actionWarning}</p>}

      {loading ? (
        <LoadingState label="Memuat pengajuan cuti..." />
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <SortableHeader colKey="nama" label="Nama" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 font-medium">Jenis</th>
                <SortableHeader colKey="periode" label="Periode" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="hari_kerja" label="Hari Kerja" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="sisa_kuota" label="Sisa Kuota" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 font-medium">Alasan</th>
                <SortableHeader colKey="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState message="Tidak ada pengajuan yang cocok dengan filter ini." />
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const master = masterByEmpId[row.employee_id];
                  const sisa = hitungSisaCuti(master);
                  return (
                    <tr key={row.id} className="border-b border-[#E0E0E0] last:border-0">
                      <td className="px-4 py-3 text-black whitespace-nowrap">{empById[row.employee_id]?.nama || '—'}</td>
                      <td className="px-4 py-3 text-[#6B6B6B] whitespace-nowrap">
                        {labelJenisCuti(row.jenis)}
                        {row.lampiran_drive_id && (
                          <a
                            href={`/api/leave-requests/${row.id}/lampiran`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-[11px] text-madael-red hover:text-madael-dark"
                          >
                            Lihat lampiran
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#6B6B6B] whitespace-nowrap">
                        {formatTanggal(row.tanggal_mulai)} — {formatTanggal(row.tanggal_selesai)}
                      </td>
                      <td className="px-4 py-3 text-[#6B6B6B]">
                        {hitungHariKerja(row.tanggal_mulai, row.tanggal_selesai, hariKerjaByEmpId[row.employee_id])}
                      </td>
                      <td className="px-4 py-3 text-[#6B6B6B] whitespace-nowrap">
                        {!potongKuota(row.jenis)
                          ? <span className="text-[#9A9A9A]">tidak memotong</span>
                          : sisa ? `${sisa.sisa}/${sisa.jatah}` : <span className="text-[#9A9A9A]">belum terhubung</span>}
                      </td>
                      <td className="px-4 py-3 text-[#6B6B6B] max-w-[200px] truncate" title={row.alasan}>{row.alasan}</td>
                      <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {row.status === 'pending' ? (
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => handleDecision(row, 'approved')}
                              disabled={actingId === row.id}
                              className="inline-flex items-center gap-1 text-xs text-green-700 hover:text-green-900 font-medium disabled:opacity-50"
                            >
                              <Check size={12} /> Setujui
                            </button>
                            <button
                              onClick={() => handleDecision(row, 'rejected')}
                              disabled={actingId === row.id}
                              className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium disabled:opacity-50"
                            >
                              <XIcon size={12} /> Tolak
                            </button>
                          </div>
                        ) : row.status === 'approved' ? (
                          <button
                            onClick={() => handleDecision(row, 'cancelled')}
                            disabled={actingId === row.id}
                            className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium disabled:opacity-50"
                          >
                            <RotateCcw size={12} /> Batalkan
                          </button>
                        ) : (
                          <span className="text-xs text-[#9A9A9A]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}