'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { Check, X as XIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { notifyEmployee } from '@/lib/notify';
import { logActivity } from '@/lib/activityLog';
import { PROFILE_EDITABLE_FIELDS, fieldLabel } from '@/lib/profileFields';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

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

export default function ProfileRequestsAdminPage() {
  const supabase = createClient();
  const { status, employee } = useModuleAccess('profile_admin');

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actingId, setActingId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [noteById, setNoteById] = useState({});
  const [showAll, setShowAll] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from('profile_change_requests')
      .select('*, employees:employee_id ( nama, employee_id )')
      .order('created_at', { ascending: false });

    if (error) {
      setLoadError(error.message || 'Gagal memuat pengajuan.');
      setLoading(false);
      return;
    }

    setRequests(data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (status === 'allowed') loadData();
  }, [status, loadData]);

  const handleDecision = async (row, decision) => {
    setActionError(null);
    setActingId(row.id);

    const catatanReviewer = (noteById[row.id] || '').trim() || null;

    // Kalau disetujui, apply field_changes ke employees_master dulu — kalau
    // gagal, jangan lanjut ubah status request (biar tidak "disetujui" tapi
    // datanya sebenarnya belum ke-update).
    if (decision === 'approved') {
      const updates = {};
      Object.entries(row.field_changes || {}).forEach(([key, change]) => {
        updates[key] = change.after;
      });

      const { error: masterError } = await supabase
        .from('employees_master')
        .update(updates)
        .eq('id', row.master_id);

      if (masterError) {
        setActingId(null);
        setActionError('Gagal menerapkan perubahan ke data master: ' + masterError.message);
        return;
      }
    }

    const { data, error } = await supabase
      .from('profile_change_requests')
      .update({
        status: decision,
        catatan_reviewer: catatanReviewer,
        reviewed_by: employee.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .select('*, employees:employee_id ( nama, employee_id )')
      .single();

    setActingId(null);

    if (error) {
      setActionError('Data master ' + (decision === 'approved' ? 'sudah' : '') + ' terupdate, tapi gagal update status pengajuan: ' + error.message);
      return;
    }

    setRequests((prev) => prev.map((r) => (r.id === data.id ? data : r)));

    const label = decision === 'approved' ? 'disetujui' : 'ditolak';
    const fieldsLabel = Object.keys(row.field_changes || {}).map(fieldLabel).join(', ');
    notifyEmployee(supabase, {
      userId: row.employee_id,
      tipe: `profil_${decision}`,
      pesan: `Pengajuan perubahan profil kamu (${fieldsLabel}) telah ${label}.${catatanReviewer ? ' Catatan: ' + catatanReviewer : ''}`,
      link: '/employee/profile',
    });

    logActivity(supabase, {
      userId: employee.id,
      aksi: `${decision === 'approved' ? 'approve' : 'reject'}_profil`,
      targetTable: 'profile_change_requests',
      targetId: row.id,
      detail: { employee_id: row.employee_id, field_changes: row.field_changes, catatan_reviewer: catatanReviewer },
    });
  };

  if (status === 'loading' || (status === 'allowed' && loading)) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <LoadingState label="Memuat pengajuan..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  const visibleRequests = showAll ? requests : requests.filter((r) => r.status === 'pending');
  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Kelola Perubahan Profil</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">
            {pendingCount > 0 ? `${pendingCount} pengajuan menunggu review.` : 'Tidak ada pengajuan yang menunggu.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-madael-red hover:text-madael-dark font-medium"
        >
          {showAll ? 'Tampilkan yang pending saja' : 'Tampilkan semua riwayat'}
        </button>
      </div>

      {actionError && <p className="text-xs text-red-600 mb-4">{actionError}</p>}

      {visibleRequests.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Belum ada pengajuan." />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleRequests.map((row) => (
            <div key={row.id} className="bg-white border border-[#E0E0E0] p-5">
              <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-black">
                    {row.employees?.nama || 'Karyawan'} {row.employees?.employee_id ? `· ${row.employees.employee_id}` : ''}
                  </p>
                  <p className="text-xs text-[#9A9A9A]">
                    {new Date(row.created_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <StatusBadge status={row.status} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                {Object.entries(row.field_changes || {}).map(([key, change]) => (
                  <div key={key} className="text-sm">
                    <span className="text-[#6B6B6B] text-xs block">{fieldLabel(key)}</span>
                    <span className="text-[#9A9A9A] line-through mr-2">{change.before || '(kosong)'}</span>
                    <span className="text-black font-medium">{change.after || '(kosong)'}</span>
                  </div>
                ))}
              </div>

              {row.catatan_karyawan && (
                <p className="text-xs text-[#6B6B6B] mb-3">Catatan karyawan: {row.catatan_karyawan}</p>
              )}

              {row.status === 'pending' ? (
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                  <input
                    value={noteById[row.id] || ''}
                    onChange={(e) => setNoteById((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    placeholder="Catatan reviewer (opsional)"
                    className="flex-1 border border-[#E0E0E0] px-3 py-2 text-sm text-black focus:outline-none focus:border-madael-red"
                  />
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={actingId === row.id}
                      onClick={() => handleDecision(row, 'approved')}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-green-600 hover:bg-green-700 transition-colors disabled:opacity-50"
                    >
                      <Check size={14} /> Setujui
                    </button>
                    <button
                      type="button"
                      disabled={actingId === row.id}
                      onClick={() => handleDecision(row, 'rejected')}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-madael-red hover:bg-madael-dark transition-colors disabled:opacity-50"
                    >
                      <XIcon size={14} /> Tolak
                    </button>
                  </div>
                </div>
              ) : (
                row.catatan_reviewer && (
                  <p className="text-xs text-[#6B6B6B]">Catatan reviewer: {row.catatan_reviewer}</p>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
