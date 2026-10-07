'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Check, X as XIcon } from 'lucide-react';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN } from '@/lib/leave';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import Toast from '@/components/employee-list/Toast';
import {
  JENIS_HARI_LEMBUR, JENIS_HARI_LABEL, STATUS_LEMBUR_LABEL, MAKS_ALASAN_LEMBUR,
} from '@/lib/overtimeRules';

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatJam(value) {
  return value ? value.slice(0, 5) : '—';
}

function jamTeks(menit) {
  return String(Number((menit / 60).toFixed(2))).replace('.', ',');
}

function StatusBadge({ status }) {
  const map = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    cancelled: 'bg-[#F4F4F4] text-[#6B6B6B]',
  };
  return (
    <span className={`text-[10px] font-medium tracking-[0.04em] px-2 py-1 ${map[status] || 'bg-[#F4F4F4] text-[#6B6B6B]'}`}>
      {STATUS_LEMBUR_LABEL[status] || status?.toUpperCase()}
    </span>
  );
}

const inputClass =
  'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors w-full';

// Dialog persetujuan: jam disetujui (default = durasi pengajuan, tidak boleh
// lebih) dan jenis hari (default = hasil turunan jadwal; admin menimpanya
// untuk hari libur nasional).
function ApproveDialog({ row, saving, error, onSubmit, onClose }) {
  const jamAjuan = Number((row.durasi_menit / 60).toFixed(2));
  const [jam, setJam] = useState(String(jamAjuan));
  const [jenisHari, setJenisHari] = useState(row.jenis_hari);
  const isDirty = jam !== String(jamAjuan) || jenisHari !== row.jenis_hari;
  const handleBackdropClick = useModalDismiss(true, onClose, 'Tutup dialog ini? Perubahan belum disimpan.', isDirty);

  return (
    <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center px-4" onClick={handleBackdropClick}>
      <div className="bg-white border-t-4 border-madael-red w-full max-w-[440px] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-serif text-xl text-black mb-1">Setujui Lembur</h2>
        <p className="text-xs text-[#6B6B6B] mb-4">
          {row.employee_nama} · {formatTanggal(row.tanggal)} · {formatJam(row.jam_mulai)}–{formatJam(row.jam_selesai)} ({jamTeks(row.durasi_menit)} jam diajukan)
        </p>
        <p className="text-xs text-[#6B6B6B] mb-4 break-words">Alasan: {row.alasan}</p>

        <label className="flex flex-col gap-1 mb-4">
          <span className="text-xs text-[#6B6B6B]">Jam disetujui (maks {String(jamAjuan).replace('.', ',')})</span>
          <input
            type="number"
            min="0.25"
            max={jamAjuan}
            step="0.25"
            value={jam}
            onChange={(e) => setJam(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 mb-4">
          <span className="text-xs text-[#6B6B6B]">Jenis hari</span>
          <select value={jenisHari} onChange={(e) => setJenisHari(e.target.value)} className={inputClass}>
            {JENIS_HARI_LEMBUR.map((k) => <option key={k} value={k}>{JENIS_HARI_LABEL[k]}</option>)}
          </select>
          <span className="text-[11px] text-[#9A9A9A]">
            Ubah ke &quot;Hari Libur Nasional&quot; bila tanggalnya libur nasional — sistem belum punya daftar hari libur.
          </span>
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
            onClick={() => onSubmit({ jam_disetujui: jam, jenis_hari: jenisHari })}
            disabled={saving}
            className="bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Setujui'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectDialog({ row, saving, error, onSubmit, onClose }) {
  const [alasan, setAlasan] = useState('');
  const handleBackdropClick = useModalDismiss(true, onClose, 'Tutup dialog ini? Alasan yang diketik tidak akan tersimpan.', alasan.trim() !== '');

  return (
    <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center px-4" onClick={handleBackdropClick}>
      <div className="bg-white border-t-4 border-madael-red w-full max-w-[440px] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-serif text-xl text-black mb-1">Tolak Lembur</h2>
        <p className="text-xs text-[#6B6B6B] mb-4">
          {row.employee_nama} · {formatTanggal(row.tanggal)} · {formatJam(row.jam_mulai)}–{formatJam(row.jam_selesai)}
        </p>

        <label className="flex flex-col gap-1 mb-4">
          <span className="text-xs text-[#6B6B6B]">Alasan penolakan (wajib)</span>
          <textarea
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            rows={3}
            maxLength={MAKS_ALASAN_LEMBUR}
            className={`${inputClass} resize-none`}
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
            disabled={saving || !alasan.trim()}
            className="bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Tolak'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OvertimeAdminPage() {
  const { status, employee } = useModuleAccess('overtime_admin');

  const [statusFilter, setStatusFilter] = useState('pending');
  const [periode, setPeriode] = useState('');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [dialog, setDialog] = useState(null); // { type: 'approve' | 'reject', row }
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState(null);
  const [toast, setToast] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams({ status: statusFilter });
      if (periode) qs.set('periode', periode);
      const res = await fetch(`/api/overtime-requests/admin?${qs.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(json.error || 'Gagal memuat pengajuan lembur.');
        setLoading(false);
        return;
      }
      setRequests(json.requests || []);
    } catch (err) {
      console.error('Muat data kelola lembur error:', err);
      setLoadError('Gagal memuat pengajuan lembur. Periksa koneksi lalu coba lagi.');
    }
    setLoading(false);
  }, [statusFilter, periode]);

  useEffect(() => {
    if (status === 'allowed') loadData();
  }, [status, loadData]);

  const closeDialog = useCallback(() => {
    setDialog(null);
    setDialogError(null);
  }, []);

  const submitDecision = async (decision, extra) => {
    if (!dialog) return;
    setSaving(true);
    setDialogError(null);
    try {
      const res = await fetch(`/api/overtime-requests/${dialog.row.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDialogError(json.error || 'Gagal memproses pengajuan lembur.');
        if (res.status === 409) {
          // diproses pihak lain / dibatalkan karyawan — sinkronkan layar
          closeDialog();
          setToast({ type: 'error', message: json.error });
          loadData();
        }
        setSaving(false);
        return;
      }
      closeDialog();
      setToast({ type: 'success', message: decision === 'approved' ? 'Lembur disetujui.' : 'Lembur ditolak.' });
      loadData();
    } catch (err) {
      console.error('Proses lembur error:', err);
      setDialogError('Gagal memproses pengajuan lembur. Periksa koneksi lalu coba lagi.');
    }
    setSaving(false);
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
          <p className="text-sm text-black mb-6">Halaman ini khusus pemegang akses Kelola Lembur.</p>
          <Link
            href="/employee/dashboard"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali
          </Link>
        </div>
      </section>
    );
  }

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const bolehProsesSendiri = SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN && employee?.is_superadmin;

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-10">
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className="mb-6">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Kelola Lembur</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">Tinjau dan setujui/tolak pengajuan lembur karyawan.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[#6B6B6B]">Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectClass}>
            <option value="pending">Menunggu</option>
            <option value="approved">Disetujui</option>
            <option value="rejected">Ditolak</option>
            <option value="cancelled">Dibatalkan</option>
            <option value="all">Semua</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[#6B6B6B]">Periode (bulan lembur)</span>
          <input type="month" value={periode} onChange={(e) => setPeriode(e.target.value)} className={selectClass} />
        </label>
        {periode && (
          <button onClick={() => setPeriode('')} className="text-xs text-madael-red hover:text-madael-dark font-medium pb-2.5">
            Semua periode
          </button>
        )}
      </div>

      {loadError ? (
        <ErrorState message={loadError} onRetry={loadData} />
      ) : loading ? (
        <LoadingState label="Memuat pengajuan lembur..." />
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Karyawan</th>
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Jam</th>
                <th className="px-4 py-3 font-medium">Durasi</th>
                <th className="px-4 py-3 font-medium">Jenis Hari</th>
                <th className="px-4 py-3 font-medium">Alasan</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState message="Tidak ada pengajuan lembur yang cocok dengan filter ini." />
                  </td>
                </tr>
              ) : (
                requests.map((row) => {
                  const milikSendiri = row.employee_id === employee?.id && !bolehProsesSendiri;
                  return (
                    <tr key={row.id} className="border-b border-[#E0E0E0] last:border-0 align-top">
                      <td className="px-4 py-3 text-black whitespace-nowrap">{row.employee_nama}</td>
                      <td className="px-4 py-3 text-[#6B6B6B] whitespace-nowrap">{formatTanggal(row.tanggal)}</td>
                      <td className="px-4 py-3 text-[#6B6B6B] whitespace-nowrap">{formatJam(row.jam_mulai)} – {formatJam(row.jam_selesai)}</td>
                      <td className="px-4 py-3 text-black whitespace-nowrap">
                        {jamTeks(row.durasi_menit)} jam
                        {row.status === 'approved' && row.jam_disetujui !== null && Number(row.jam_disetujui) * 60 !== row.durasi_menit && (
                          <p className="text-[11px] text-[#9A9A9A]">disetujui {String(Number(row.jam_disetujui)).replace('.', ',')} jam</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#6B6B6B]">{JENIS_HARI_LABEL[row.jenis_hari] || row.jenis_hari}</td>
                      <td className="px-4 py-3 text-[#6B6B6B] max-w-[200px] truncate" title={row.alasan}>{row.alasan}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={row.status} />
                        {row.status === 'rejected' && row.rejection_reason && (
                          <p className="text-[11px] text-[#9A9A9A] mt-1 max-w-[160px]" title={row.rejection_reason}>{row.rejection_reason}</p>
                        )}
                        {row.approved_by_nama && (row.status === 'approved' || row.status === 'rejected') && (
                          <p className="text-[11px] text-[#9A9A9A] mt-1">oleh {row.approved_by_nama}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {row.status === 'pending' && milikSendiri && (
                          <span className="text-xs text-[#9A9A9A]" title="Tidak boleh memproses pengajuan lembur milik sendiri.">
                            Pengajuan sendiri
                          </span>
                        )}
                        {row.status === 'pending' && !milikSendiri && (
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => { setDialogError(null); setDialog({ type: 'approve', row }); }}
                              className="inline-flex items-center gap-1 text-xs text-green-700 hover:text-green-900 font-medium"
                            >
                              <Check size={12} /> Setujui
                            </button>
                            <button
                              onClick={() => { setDialogError(null); setDialog({ type: 'reject', row }); }}
                              className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium"
                            >
                              <XIcon size={12} /> Tolak
                            </button>
                          </div>
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

      {dialog?.type === 'approve' && (
        <ApproveDialog
          row={dialog.row}
          saving={saving}
          error={dialogError}
          onSubmit={(extra) => submitDecision('approved', extra)}
          onClose={closeDialog}
        />
      )}
      {dialog?.type === 'reject' && (
        <RejectDialog
          row={dialog.row}
          saving={saving}
          error={dialogError}
          onSubmit={(extra) => submitDecision('rejected', extra)}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
