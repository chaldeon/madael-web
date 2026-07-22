'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Check, X as XIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { notifyEmployee } from '@/lib/notify';
import { logActivity } from '@/lib/activityLog';
import { hitungHariKerja, hitungSisaCuti } from '@/lib/leave';
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
  };
  const label = { pending: 'MENUNGGU', approved: 'DISETUJUI', rejected: 'DITOLAK' };
  return (
    <span className={`text-[10px] font-medium tracking-[0.04em] px-2 py-1 ${map[status] || 'bg-[#F4F4F4] text-[#6B6B6B]'}`}>
      {label[status] || status?.toUpperCase()}
    </span>
  );
}

export default function LeaveRequestAdminPage() {
  const supabase = createClient();
  const { status, employee } = useModuleAccess('leave_request');
  const isSuperadmin = !!employee?.is_superadmin;

  const [statusFilter, setStatusFilter] = useState('pending');
  const [employees, setEmployees] = useState([]);
  const [requests, setRequests] = useState([]);
  const [schedules, setSchedules] = useState([]); // work_schedule rows
  const [masterList, setMasterList] = useState([]); // employees_master rows (kolom kuota saja)
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionWarning, setActionWarning] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const [empRes, reqRes, schedRes, masterRes] = await Promise.all([
      supabase.from('employees').select('id, nama, perusahaan').order('nama'),
      supabase.from('leave_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('work_schedule').select('employee_id, hari_kerja'),
      supabase.from('employees_master').select('id, linked_employee_id, jatah_cuti_tahunan, cuti_terpakai, cuti_terpakai_tahun'),
    ]);

    const firstError = empRes.error || reqRes.error || schedRes.error || masterRes.error;
    if (firstError) {
      setLoadError(firstError.message || 'Gagal memuat data pengajuan cuti.');
      setLoading(false);
      return;
    }

    setEmployees(empRes.data || []);
    setRequests(reqRes.data || []);
    setSchedules(schedRes.data || []);
    setMasterList(masterRes.data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (status === 'allowed' && isSuperadmin) loadData();
  }, [status, isSuperadmin, loadData]);

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
    if (statusFilter === 'all') return requests;
    return requests.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  const handleDecision = async (row, decision) => {
    setActionError(null);
    setActionWarning(null);
    setActingId(row.id);

    const { data, error } = await supabase
      .from('leave_requests')
      .update({ status: decision, approved_by: employee.id, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .select()
      .single();

    if (error) {
      setActingId(null);
      setActionError(error.message || 'Gagal memperbarui status pengajuan.');
      return;
    }
    setRequests((prev) => prev.map((r) => (r.id === data.id ? data : r)));

    const jumlahHari = hitungHariKerja(row.tanggal_mulai, row.tanggal_selesai, hariKerjaByEmpId[row.employee_id]);
    let warning = null;

    if (decision === 'approved') {
      const master = masterByEmpId[row.employee_id];
      if (!master) {
        warning = 'Cuti disetujui. Karyawan ini belum terhubung ke data master (Payroll), sisa kuota tidak diperbarui.';
      } else {
        const currentYear = new Date().getFullYear();
        const { terpakai: terpakaiSebelum } = hitungSisaCuti(master, currentYear);
        const terpakaiBaru = terpakaiSebelum + jumlahHari;

        const { error: quotaError } = await supabase
          .from('employees_master')
          .update({ cuti_terpakai: terpakaiBaru, cuti_terpakai_tahun: currentYear })
          .eq('id', master.id);

        if (quotaError) {
          warning = 'Cuti disetujui, tapi gagal update kuota: ' + quotaError.message;
        } else {
          setMasterList((prev) => prev.map((m) => (
            m.id === master.id ? { ...m, cuti_terpakai: terpakaiBaru, cuti_terpakai_tahun: currentYear } : m
          )));
        }
      }
    }

    setActingId(null);
    setActionWarning(warning);

    const label = decision === 'approved' ? 'disetujui' : 'ditolak';
    notifyEmployee(supabase, {
      userId: row.employee_id,
      tipe: `cuti_${decision}`,
      pesan: `Pengajuan cuti kamu (${formatTanggal(row.tanggal_mulai)} – ${formatTanggal(row.tanggal_selesai)}, ${jumlahHari} hari kerja) telah ${label}.`,
      link: '/employee/leave-request',
    });

    logActivity(supabase, {
      userId: employee.id,
      aksi: `${decision === 'approved' ? 'approve' : 'reject'}_cuti`,
      targetTable: 'leave_requests',
      targetId: row.id,
      detail: { employee_id: row.employee_id, tanggal_mulai: row.tanggal_mulai, tanggal_selesai: row.tanggal_selesai, jumlah_hari_kerja: jumlahHari },
    });
  };

  if (status === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat data..." />
      </section>
    );
  }

  if (status === 'denied' || !isSuperadmin) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Halaman ini khusus superadmin.</p>
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
                <th className="px-4 py-3 font-medium">Nama</th>
                <th className="px-4 py-3 font-medium">Periode</th>
                <th className="px-4 py-3 font-medium">Hari Kerja</th>
                <th className="px-4 py-3 font-medium">Sisa Kuota</th>
                <th className="px-4 py-3 font-medium">Alasan</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-0">
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
                        {formatTanggal(row.tanggal_mulai)} — {formatTanggal(row.tanggal_selesai)}
                      </td>
                      <td className="px-4 py-3 text-[#6B6B6B]">
                        {hitungHariKerja(row.tanggal_mulai, row.tanggal_selesai, hariKerjaByEmpId[row.employee_id])}
                      </td>
                      <td className="px-4 py-3 text-[#6B6B6B] whitespace-nowrap">
                        {sisa ? `${sisa.sisa}/${sisa.jatah}` : <span className="text-[#9A9A9A]">belum terhubung</span>}
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