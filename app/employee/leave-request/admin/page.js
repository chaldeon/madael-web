'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Check, X as XIcon, RotateCcw, ArrowUp, ArrowDown, ArrowUpDown, Plus } from 'lucide-react';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { DEFAULT_KEBIJAKAN_CUTI } from '@/lib/leavePolicy';
import { hariCutiBaris, hitungSisaCuti, labelJenisCuti, potongKuota, MAKS_CATATAN_TOLAK_CUTI, FILTER_MINTA_BATAL_CUTI } from '@/lib/leave';
import { petaLibur, liburUntukJadwal } from '@/lib/publicHolidays';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import ConfirmDialog from '@/components/ConfirmDialog';
import LeavePolicyCard from '@/components/LeavePolicyCard';
import LeaveOnBehalfDialog from '@/components/LeaveOnBehalfDialog';
import PaginationBar from '@/components/PaginationBar';
import ExportCsvButton from '@/components/ExportCsvButton';
import { ADMIN_PAGE_SIZE_DEFAULT, totalPagesOf } from '@/lib/pagination';
import { CUTI_CSV_HEADERS, ambilBarisEkspor, tanggalUntukNamaFile } from '@/lib/adminCsvExport';

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatWaktuMinta(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta',
  });
}

// Status permintaan batal dari karyawan (kolom minta_batal_*), tampil di bawah
// badge status pengajuan. Tidak ada permintaan = tidak tampil.
function MintaBatalInfo({ row }) {
  if (!row.minta_batal_status) return null;
  if (row.minta_batal_status === 'menunggu') {
    return (
      <div className="mt-1.5 max-w-[200px] whitespace-normal break-words">
        <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-amber-100 text-amber-800">MINTA BATAL</span>
        <p className="text-[11px] text-[#9A9A9A] mt-1">Diminta karyawan {formatWaktuMinta(row.minta_batal_at)}</p>
        {row.minta_batal_alasan && (
          <p className="text-[11px] text-[#6B6B6B] mt-0.5">Alasan: {row.minta_batal_alasan}</p>
        )}
      </div>
    );
  }
  if (row.minta_batal_status === 'ditolak') {
    return (
      <p className="text-[11px] text-[#9A9A9A] mt-1.5 max-w-[200px] whitespace-normal break-words">
        Permintaan batal ditolak{row.minta_batal_catatan ? `: ${row.minta_batal_catatan}` : ''}
      </p>
    );
  }
  return <p className="text-[11px] text-[#9A9A9A] mt-1.5">Atas permintaan karyawan</p>;
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
  hari_kerja: { get: (r, ctx) => hariCutiBaris(r, ctx.hariKerjaByEmpId[r.employee_id], ctx.liburByEmpId[r.employee_id] ?? ctx.libur) },
  sisa_kuota: {
    get: (r, ctx) => {
      const sisa = hitungSisaCuti(ctx.masterByEmpId[r.employee_id], undefined, ctx.kebijakan);
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

function RejectDialog({ row, namaKaryawan, saving, error, onSubmit, onClose }) {
  const [alasan, setAlasan] = useState('');
  const handleBackdropClick = useModalDismiss(true, onClose, 'Tutup dialog ini? Alasan yang diketik tidak akan tersimpan.', alasan.trim() !== '');

  return (
    <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center px-4" onClick={handleBackdropClick}>
      <div className="bg-white border-t-4 border-madael-red w-full max-w-[440px] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-serif text-xl text-black mb-1">Tolak Pengajuan {potongKuota(row.jenis) ? 'Cuti' : labelJenisCuti(row.jenis)}</h2>
        <p className="text-xs text-[#6B6B6B] mb-4">
          {namaKaryawan} · {formatTanggal(row.tanggal_mulai)} — {formatTanggal(row.tanggal_selesai)}
        </p>

        <label className="flex flex-col gap-1 mb-4">
          <span className="text-xs text-[#6B6B6B]">Alasan penolakan (opsional, akan dilihat karyawan)</span>
          <textarea
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            rows={3}
            maxLength={MAKS_CATATAN_TOLAK_CUTI}
            className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors resize-none"
          />
        </label>

        {error && <p className="text-xs text-red-600 mb-4">{error}</p>}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={handleBackdropClick}
            disabled={saving}
            className="border border-[#E0E0E0] text-black px-5 py-2 text-sm hover:border-madael-red transition-colors disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => onSubmit({ rejection_reason: alasan.trim() })}
            disabled={saving}
            className="bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Tolak'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LeaveRequestAdminPage() {
  const { status } = useModuleAccess('leave_request_admin');

  // Tautan dari notifikasi / Inbox Persetujuan membuka filter permintaan batal
  // (?status=minta_batal); selain itu filter awal tetap 'pending'.
  const searchParams = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(
    () => (searchParams.get('status') === FILTER_MINTA_BATAL_CUTI ? FILTER_MINTA_BATAL_CUTI : 'pending')
  );
  const [sortField, setSortField] = useState('periode');
  const [sortDir, setSortDir] = useState('desc');
  const [employees, setEmployees] = useState([]);
  const [requests, setRequests] = useState([]);
  const [schedules, setSchedules] = useState([]); // work_schedule rows
  const [liburList, setLiburList] = useState([]); // hari libur nasional/cuti bersama (tahun ini & depan)
  const [masterList, setMasterList] = useState([]); // employees_master rows (kolom kuota saja)
  const [kebijakan, setKebijakan] = useState(DEFAULT_KEBIJAKAN_CUTI); // kebijakan kuota cuti (leave_policies)
  const [kebijakanVersi, setKebijakanVersi] = useState(null);
  const [bisaUbahKebijakan, setBisaUbahKebijakan] = useState(false);
  // Paginasi server-side: filter status dan halaman diproses di route.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ADMIN_PAGE_SIZE_DEFAULT);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionWarning, setActionWarning] = useState(null);
  const [rejectingRow, setRejectingRow] = useState(null); // baris yang sedang ditolak (dialog alasan)
  const [revokeTarget, setRevokeTarget] = useState(null); // baris cuti disetujui yang menunggu konfirmasi pembatalan
  const [rejectCancelTarget, setRejectCancelTarget] = useState(null); // baris dengan permintaan batal yang akan ditolak
  const [rejectCancelCatatan, setRejectCancelCatatan] = useState('');
  const [inputOpen, setInputOpen] = useState(false); // dialog catat cuti atas nama karyawan
  const [inputInfo, setInputInfo] = useState(null); // pesan sukses setelah mencatat

  // Data dimuat lewat route server (bukan query browser) karena employees_master
  // dibatasi RLS superadmin — lihat catatan di app/api/leave-requests/admin.
  // Daftar pengajuan dimuat per halaman; filter status ikut dikirim ke server.
  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const qs = new URLSearchParams({ status: statusFilter, page: String(page), pageSize: String(pageSize) });
      const res = await fetch(`/api/leave-requests/admin?${qs.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(json.error || 'Gagal memuat data pengajuan cuti.');
        return;
      }

      // Halaman melewati akhir data (mis. sisa baris habis diproses): kembali ke
      // halaman 1 — perubahan page memicu muat ulang otomatis.
      if (json.outOfRange && page > 1) {
        setPage(1);
        return;
      }
      const total = Number(json.total) || 0;
      if ((json.requests || []).length === 0 && total > 0 && page > 1) {
        setPage(totalPagesOf(total, pageSize));
        return;
      }

      setEmployees(json.employees || []);
      setRequests(json.requests || []);
      setSchedules(json.schedules || []);
      setLiburList(json.libur || []);
      setMasterList(json.master || []);
      setTotalCount(total);
      setKebijakan(json.kebijakan || DEFAULT_KEBIJAKAN_CUTI);
      setKebijakanVersi(json.kebijakanVersi || null);
      setBisaUbahKebijakan(!!json.bisaUbahKebijakan);
    } catch {
      setLoadError('Gagal memuat data pengajuan cuti. Periksa koneksi internet kamu.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, pageSize]);

  useEffect(() => {
    if (status === 'allowed') loadData();
  }, [status, loadData]);

  // Ekspor CSV: seluruh pengajuan sesuai filter status aktif (bukan hanya
  // halaman yang tampil), diambil lewat route server.
  const loadExportRows = useCallback(
    () => ambilBarisEkspor(
      `/api/leave-requests/admin/export?${new URLSearchParams({ status: statusFilter }).toString()}`,
      'Gagal mengekspor pengajuan cuti.'
    ),
    [statusFilter]
  );

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

  // Hari libur nasional/cuti bersama; per karyawan kosong kalau jadwalnya
  // menandai bekerja di hari libur. Hanya memengaruhi pengajuan pending
  // (lihat hariCutiBaris).
  const libur = useMemo(() => petaLibur(liburList), [liburList]);
  const liburByEmpId = useMemo(() => {
    const map = {};
    schedules.forEach((s) => { map[s.employee_id] = liburUntukJadwal(libur, s); });
    return map;
  }, [schedules, libur]);

  // employee_id (akun portal) -> row employees_master, lewat linked_employee_id.
  // Employee yang belum di-link (linked_employee_id null) sengaja tidak masuk map ini.
  const masterByEmpId = useMemo(() => {
    const map = {};
    masterList.forEach((m) => { if (m.linked_employee_id) map[m.linked_employee_id] = m; });
    return map;
  }, [masterList]);

  const rows = useMemo(() => {
    // Filter status sudah diterapkan di server; urutan kolom hanya berlaku pada
    // baris di halaman yang sedang dibuka.
    const filtered = requests;

    const ctx = { empById, hariKerjaByEmpId, liburByEmpId, libur, masterByEmpId, kebijakan };
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
  }, [requests, sortField, sortDir, empById, hariKerjaByEmpId, liburByEmpId, libur, masterByEmpId, kebijakan]);

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
  // extra: field tambahan di body (mis. { rejection_reason } saat menolak).
  // Mengembalikan 'ok' | 'conflict' | 'error'.
  // Konfirmasi pembatalan cuti disetujui ada di ConfirmDialog (revokeTarget) di bawah.
  const handleDecision = async (row, decision, extra = {}) => {
    setActionError(null);
    setActionWarning(null);
    setActingId(row.id);

    try {
      const res = await fetch(`/api/leave-requests/${row.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, ...extra }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setActionError(json.error || 'Gagal memperbarui status pengajuan.');
        if (res.status === 409) {
          loadData(); // status/kuota berubah di sisi lain — sinkronkan layar
          return 'conflict';
        }
        return 'error';
      }

      setRequests((prev) => prev.map((r) => (r.id === json.request.id ? json.request : r)));
      if (json.kuota) {
        setMasterList((prev) => prev.map((m) => (
          m.id === json.kuota.master_id
            ? {
                ...m,
                cuti_terpakai: json.kuota.cuti_terpakai,
                cuti_terpakai_tahun: json.kuota.cuti_terpakai_tahun,
                cuti_carry_over: json.kuota.cuti_carry_over,
                cuti_carry_over_tahun: json.kuota.cuti_carry_over_tahun,
              }
            : m
        )));
      }
      setActionWarning(json.warning || null);
      return 'ok';
    } catch {
      setActionError('Gagal memproses pengajuan. Periksa koneksi internet kamu.');
      return 'error';
    } finally {
      setActingId(null);
    }
  };

  // Tolak permintaan batal dari karyawan: cuti tetap berlaku, hanya status
  // permintaannya yang berubah (route reject-cancel). Setujui permintaan =
  // aksi Batalkan di atas (decision 'cancelled'), yang ikut menandai permintaan.
  const handleRejectCancel = async (row, catatan) => {
    setActionError(null);
    setActionWarning(null);
    setActingId(row.id);
    try {
      const res = await fetch(`/api/leave-requests/${row.id}/reject-cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catatan }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(json.error || 'Gagal menolak permintaan pembatalan.');
        if (res.status === 409) loadData();
        return;
      }
      setRequests((prev) => prev.map((r) => (r.id === json.request.id ? json.request : r)));
    } catch {
      setActionError('Gagal memproses permintaan pembatalan. Periksa koneksi internet kamu.');
    } finally {
      setActingId(null);
    }
  };

  // Cuti dicatat HR atas nama karyawan: baris baru berstatus disetujui dan kuota
  // sudah berubah di server, jadi data dimuat ulang (karyawan di baris baru
  // belum ada di peta karyawan/jadwal/master halaman ini).
  const handleInputSaved = (json) => {
    setInputOpen(false);
    setActionError(null);
    setActionWarning(json.warning || null);
    setInputInfo(`Tercatat dan langsung disetujui (${json.jumlahHari} hari kerja). Karyawan sudah diberi notifikasi.`);
    if (statusFilter === 'pending' || statusFilter === FILTER_MINTA_BATAL_CUTI) {
      setStatusFilter('approved');
      setPage(1);
    } else {
      loadData();
    }
  };

  const handleRejectSubmit = async (extra) => {
    if (!rejectingRow) return;
    const hasil = await handleDecision(rejectingRow, 'rejected', extra);
    // Gagal biasa: dialog tetap terbuka supaya pesan error terlihat dan bisa
    // dicoba lagi. Berhasil / bentrok status: tutup (daftar sudah disinkronkan).
    if (hasil === 'ok' || hasil === 'conflict') setRejectingRow(null);
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
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className={selectClass}
        >
          <option value="pending">Menunggu</option>
          <option value="approved">Disetujui</option>
          <option value={FILTER_MINTA_BATAL_CUTI}>Permintaan batal</option>
          <option value="rejected">Ditolak</option>
          <option value="cancelled">Dibatalkan</option>
          <option value="all">Semua</option>
        </select>
        <ExportCsvButton
          filename={`pengajuan-cuti-${statusFilter}-${tanggalUntukNamaFile()}`}
          headers={CUTI_CSV_HEADERS}
          loadRows={loadExportRows}
          disabled={loading || totalCount === 0}
          neutralizeFormulas
          label="Ekspor CSV"
        />
        <button
          type="button"
          onClick={() => { setActionError(null); setActionWarning(null); setInputInfo(null); setInputOpen(true); }}
          className="inline-flex items-center gap-1.5 bg-madael-red text-white px-4 py-2 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
        >
          <Plus size={14} /> Catat atas nama karyawan
        </button>
      </div>

      <LeavePolicyCard
        kebijakan={kebijakan}
        versi={kebijakanVersi}
        bisaUbah={bisaUbahKebijakan}
        onSaved={(json) => { setKebijakan(json.kebijakan); setKebijakanVersi(json.versi); }}
        onConflict={loadData}
      />

      {actionError && <p className="text-xs text-red-600 mb-4">{actionError}</p>}
      {actionWarning && <p className="text-xs text-amber-700 mb-4">{actionWarning}</p>}
      {inputInfo && <p className="text-xs text-green-700 mb-4">{inputInfo}</p>}

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
                  const sisa = hitungSisaCuti(master, undefined, kebijakan);
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
                        {hariCutiBaris(row, hariKerjaByEmpId[row.employee_id], liburByEmpId[row.employee_id] ?? libur)}
                      </td>
                      <td className="px-4 py-3 text-[#6B6B6B] whitespace-nowrap">
                        {!potongKuota(row.jenis)
                          ? <span className="text-[#9A9A9A]">tidak memotong</span>
                          : sisa ? `${sisa.sisa}/${sisa.jatah}` : <span className="text-[#9A9A9A]">belum terhubung</span>}
                      </td>
                      <td className="px-4 py-3 text-[#6B6B6B] max-w-[200px] truncate" title={row.alasan}>{row.alasan}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                        {row.diinput_oleh && (
                          <p className="text-[11px] text-[#9A9A9A] mt-1.5 max-w-[160px]">Dicatat HR</p>
                        )}
                        {row.status === 'rejected' && row.rejection_reason && (
                          <p className="text-[11px] text-[#9A9A9A] mt-1 max-w-[160px]" title={row.rejection_reason}>{row.rejection_reason}</p>
                        )}
                        <MintaBatalInfo row={row} />
                      </td>
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
                              onClick={() => { setActionError(null); setRejectingRow(row); }}
                              disabled={actingId === row.id}
                              className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium disabled:opacity-50"
                            >
                              <XIcon size={12} /> Tolak
                            </button>
                          </div>
                        ) : row.status === 'approved' && row.minta_batal_status === 'menunggu' ? (
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => setRevokeTarget(row)}
                              disabled={actingId === row.id}
                              className="inline-flex items-center gap-1 text-xs text-green-700 hover:text-green-900 font-medium disabled:opacity-50"
                            >
                              <Check size={12} /> Setujui pembatalan
                            </button>
                            <button
                              onClick={() => { setActionError(null); setRejectCancelCatatan(''); setRejectCancelTarget(row); }}
                              disabled={actingId === row.id}
                              className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium disabled:opacity-50"
                            >
                              <XIcon size={12} /> Tolak permintaan
                            </button>
                          </div>
                        ) : row.status === 'approved' ? (
                          <button
                            onClick={() => setRevokeTarget(row)}
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

      {!loading && (
        <PaginationBar
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          catatanUrutan
          satuan="pengajuan"
        />
      )}

      {inputOpen && (
        <LeaveOnBehalfDialog
          onClose={() => setInputOpen(false)}
          onSaved={handleInputSaved}
        />
      )}

      {rejectingRow && (
        <RejectDialog
          row={rejectingRow}
          namaKaryawan={empById[rejectingRow.employee_id]?.nama || '—'}
          saving={actingId === rejectingRow.id}
          error={actionError}
          onSubmit={handleRejectSubmit}
          onClose={() => setRejectingRow(null)}
        />
      )}

      <ConfirmDialog
        open={!!revokeTarget}
        title={revokeTarget?.minta_batal_status === 'menunggu' ? 'Setujui Pembatalan Cuti' : 'Batalkan Cuti yang Sudah Disetujui'}
        message={
          revokeTarget && (
            <>
              {revokeTarget.minta_batal_status === 'menunggu' && (
                <>Karyawan meminta pembatalan ini; karyawan akan diberi tahu bahwa permintaannya disetujui.<br /></>
              )}
              Batalkan {potongKuota(revokeTarget.jenis) ? 'cuti' : labelJenisCuti(revokeTarget.jenis).toLowerCase()} yang sudah disetujui ({formatTanggal(revokeTarget.tanggal_mulai)} — {formatTanggal(revokeTarget.tanggal_selesai)})?
              {potongKuota(revokeTarget.jenis) && (
                <>
                  <br />
                  Kuota cuti karyawan akan dikembalikan.
                </>
              )}
            </>
          )
        }
        confirmLabel="Ya, Batalkan"
        busyLabel="Membatalkan..."
        busy={!!revokeTarget && actingId === revokeTarget.id}
        onConfirm={async () => {
          await handleDecision(revokeTarget, 'cancelled');
          setRevokeTarget(null);
        }}
        onCancel={() => setRevokeTarget(null)}
      />

      <ConfirmDialog
        open={!!rejectCancelTarget}
        title="Tolak Permintaan Pembatalan"
        message={
          rejectCancelTarget && (
            <>
              Tolak permintaan {empById[rejectCancelTarget.employee_id]?.nama || 'karyawan'} untuk membatalkan cuti {formatTanggal(rejectCancelTarget.tanggal_mulai)} — {formatTanggal(rejectCancelTarget.tanggal_selesai)}?
              <br />
              Cutinya tetap berlaku dan kuota tidak berubah.
            </>
          )
        }
        inputLabel="Catatan untuk karyawan (opsional)"
        inputMaxLength={MAKS_CATATAN_TOLAK_CUTI}
        value={rejectCancelCatatan}
        onChange={setRejectCancelCatatan}
        confirmLabel="Ya, Tolak Permintaan"
        busyLabel="Menolak..."
        busy={!!rejectCancelTarget && actingId === rejectCancelTarget.id}
        onConfirm={async () => {
          await handleRejectCancel(rejectCancelTarget, rejectCancelCatatan.trim());
          setRejectCancelTarget(null);
        }}
        onCancel={() => setRejectCancelTarget(null)}
      />
    </div>
  );
}