'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Check, X as XIcon, Paperclip, Wallet } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { notifyEmployee } from '@/lib/notify';
import { logActivity } from '@/lib/activityLog';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

function formatRupiah(value) {
  return 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
}

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }) {
  const map = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    paid: 'bg-blue-100 text-blue-700',
  };
  const label = { pending: 'MENUNGGU', approved: 'DISETUJUI', rejected: 'DITOLAK', paid: 'SUDAH DIBAYAR' };
  return (
    <span className={`text-[10px] font-medium tracking-[0.04em] px-2 py-1 ${map[status] || 'bg-[#F4F4F4] text-[#6B6B6B]'}`}>
      {label[status] || status?.toUpperCase()}
    </span>
  );
}

export default function ReimbursementAdminPage() {
  const supabase = createClient();
  const { status, employee } = useModuleAccess('reimbursement_admin');

  const [statusFilter, setStatusFilter] = useState('pending');
  const [employees, setEmployees] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const [empRes, reqRes] = await Promise.all([
      supabase.from('employees').select('id, nama').order('nama'),
      supabase.from('reimbursement_requests').select('*').order('created_at', { ascending: false }),
    ]);

    const firstError = empRes.error || reqRes.error;
    if (firstError) {
      setLoadError(firstError.message || 'Gagal memuat data reimbursement.');
      setLoading(false);
      return;
    }

    setEmployees(empRes.data || []);
    setRequests(reqRes.data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (status === 'allowed') loadData();
  }, [status, loadData]);

  const empById = useMemo(() => {
    const map = {};
    employees.forEach((e) => { map[e.id] = e; });
    return map;
  }, [employees]);

  const rows = useMemo(
    () => (statusFilter === 'all' ? requests : requests.filter((r) => r.status === statusFilter)),
    [requests, statusFilter]
  );

  // Total klaim approved yang belum ditandai 'paid' — jumlah ini yang perlu
  // dimasukkan admin secara manual ke field Kompensasi saat generate/edit
  // payroll run karyawan terkait (lihat catatan di bawah tabel). Kita
  // sengaja TIDAK menyuntikkan angka ini otomatis ke logic payroll
  // (lib/payroll/runSnapshot.js) supaya perhitungan gaji tetap sepenuhnya
  // under kontrol & review admin sebelum payroll run diproses.
  const totalSiapDibayar = useMemo(
    () => requests.filter((r) => r.status === 'approved').reduce((sum, r) => sum + (Number(r.jumlah) || 0), 0),
    [requests]
  );

  const handleDecision = async (row, decision) => {
    setActionError(null);

    let rejectionReason = null;
    if (decision === 'rejected') {
      rejectionReason = window.prompt('Alasan penolakan (opsional):') || null;
    }

    setActingId(row.id);
    const { data, error } = await supabase
      .from('reimbursement_requests')
      .update({
        status: decision,
        approved_by: employee.id,
        rejection_reason: rejectionReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .select()
      .single();

    setActingId(null);
    if (error) {
      setActionError(error.message || 'Gagal memperbarui status klaim.');
      return;
    }
    setRequests((prev) => prev.map((r) => (r.id === data.id ? data : r)));

    const label = decision === 'approved' ? 'disetujui' : 'ditolak';
    notifyEmployee(supabase, {
      userId: row.employee_id,
      tipe: `reimbursement_${decision}`,
      pesan: `Klaim reimbursement kamu (${formatRupiah(row.jumlah)}, ${row.kategori}) telah ${label}.`,
      link: '/employee/reimbursement',
    });

    logActivity(supabase, {
      userId: employee.id,
      aksi: `${decision === 'approved' ? 'approve' : 'reject'}_reimbursement`,
      targetTable: 'reimbursement_requests',
      targetId: row.id,
      detail: { employee_id: row.employee_id, jumlah: row.jumlah, kategori: row.kategori },
    });
  };

  // Ditandai setelah admin secara manual memasukkan nominal klaim ke field
  // Kompensasi di payroll run karyawan terkait — lihat catatan totalSiapDibayar.
  const handleMarkPaid = async (row) => {
    const note = window.prompt(
      'Catatan (opsional) — mis. periode payroll run tempat klaim ini dimasukkan:',
      ''
    );
    if (note === null) return; // user cancel

    setActionError(null);
    setActingId(row.id);
    const { data, error } = await supabase
      .from('reimbursement_requests')
      .update({ status: 'paid', paid_note: note || null, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .select()
      .single();

    setActingId(null);
    if (error) {
      setActionError(error.message || 'Gagal menandai klaim sebagai sudah dibayar.');
      return;
    }
    setRequests((prev) => prev.map((r) => (r.id === data.id ? data : r)));

    logActivity(supabase, {
      userId: employee.id,
      aksi: 'tandai_dibayar_reimbursement',
      targetTable: 'reimbursement_requests',
      targetId: row.id,
      detail: { employee_id: row.employee_id, jumlah: row.jumlah },
    });
  };

  const handleViewBukti = async (row) => {
    if (!row.bukti_path) return;
    const { data, error } = await supabase.storage.from('reimbursement-bukti').createSignedUrl(row.bukti_path, 60 * 5);
    if (error || !data?.signedUrl) {
      alert('Gagal membuka bukti: ' + (error?.message || 'terjadi kesalahan'));
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
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
          <p className="text-sm text-black mb-6">Halaman ini khusus pemegang akses Kelola Reimbursement.</p>
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

  if (loadError) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Kelola Reimbursement</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">Tinjau dan setujui/tolak klaim reimbursement karyawan.</p>
      </div>

      {totalSiapDibayar > 0 && (
        <div className="flex items-start gap-3 bg-white border-l-4 border-madael-red p-4 mb-6">
          <Wallet size={16} className="text-madael-red shrink-0 mt-0.5" />
          <p className="text-xs text-[#6B6B6B]">
            Total klaim <span className="font-medium text-black">disetujui, belum dibayar</span>: <span className="font-medium text-black">{formatRupiah(totalSiapDibayar)}</span>.
            Masukkan nominal per karyawan ke field <span className="font-medium">Kompensasi</span> saat generate/edit payroll run mereka,
            lalu klik &quot;Tandai Dibayar&quot; di baris terkait supaya tidak double-input bulan berikutnya.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectClass}>
          <option value="pending">Menunggu</option>
          <option value="approved">Disetujui (belum dibayar)</option>
          <option value="rejected">Ditolak</option>
          <option value="paid">Sudah Dibayar</option>
          <option value="all">Semua</option>
        </select>
      </div>

      {actionError && <p className="text-xs text-red-600 mb-4">{actionError}</p>}

      {loading ? (
        <LoadingState label="Memuat klaim reimbursement..." />
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Nama</th>
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Kategori</th>
                <th className="px-4 py-3 font-medium">Jumlah</th>
                <th className="px-4 py-3 font-medium">Deskripsi</th>
                <th className="px-4 py-3 font-medium">Bukti</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState message="Tidak ada klaim yang cocok dengan filter ini." />
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-[#E0E0E0] last:border-0">
                    <td className="px-4 py-3 text-black whitespace-nowrap">{empById[row.employee_id]?.nama || '—'}</td>
                    <td className="px-4 py-3 text-[#6B6B6B] whitespace-nowrap">{formatTanggal(row.created_at)}</td>
                    <td className="px-4 py-3 text-[#6B6B6B] capitalize">{row.kategori}</td>
                    <td className="px-4 py-3 text-black whitespace-nowrap">{formatRupiah(row.jumlah)}</td>
                    <td className="px-4 py-3 text-[#6B6B6B] max-w-[200px] truncate" title={row.deskripsi}>{row.deskripsi}</td>
                    <td className="px-4 py-3">
                      {row.bukti_path ? (
                        <button onClick={() => handleViewBukti(row)} className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium">
                          <Paperclip size={12} /> Lihat
                        </button>
                      ) : (
                        <span className="text-xs text-[#9A9A9A]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                      {row.status === 'rejected' && row.rejection_reason && (
                        <p className="text-[11px] text-[#9A9A9A] mt-1 max-w-[160px]" title={row.rejection_reason}>{row.rejection_reason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {row.status === 'pending' && (
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
                      )}
                      {row.status === 'approved' && (
                        <button
                          onClick={() => handleMarkPaid(row)}
                          disabled={actingId === row.id}
                          className="inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 font-medium disabled:opacity-50"
                        >
                          <Wallet size={12} /> Tandai Dibayar
                        </button>
                      )}
                      {(row.status === 'rejected' || row.status === 'paid') && (
                        <span className="text-xs text-[#9A9A9A]">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}