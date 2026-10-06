'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Check, X as XIcon, ArrowLeft, AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { fieldLabel, isAllowedProfileField } from '@/lib/profileFields';
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

// field_changes dikirim karyawan dari browser (JSON bebas), jadi bentuknya
// tidak boleh dipercaya begitu saja saat dirender.
function getChangeEntries(row) {
  const fc = row.field_changes;
  return fc && typeof fc === 'object' && !Array.isArray(fc) ? Object.entries(fc) : [];
}

// Sama dengan aturan di route: minimal satu key dan semuanya whitelist.
function getBlockedKeys(row) {
  return getChangeEntries(row).map(([key]) => key).filter((key) => !isAllowedProfileField(key));
}

function canApprove(row) {
  return getChangeEntries(row).length > 0 && getBlockedKeys(row).length === 0;
}

function tampilNilai(v) {
  if (v === null || v === undefined || v === '') return '(kosong)';
  return typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v);
}

export default function ProfileRequestsAdminPage() {
  const supabase = createClient();
  const { status } = useModuleAccess('profile_admin');
  const searchParams = useSearchParams();
  const filterEmployeeId = searchParams.get('employee');
  const filterEmployeeName = searchParams.get('nama');

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

    let query = supabase
      .from('profile_change_requests')
      .select('*, employees:employee_id ( nama, employee_id )')
      .order('created_at', { ascending: false });

    if (filterEmployeeId) {
      query = query.eq('employee_id', filterEmployeeId);
    }

    const { data, error } = await query;

    if (error) {
      setLoadError(error.message || 'Gagal memuat pengajuan.');
      setLoading(false);
      return;
    }

    setRequests(data || []);
    setLoading(false);
  }, [supabase, filterEmployeeId]);

  useEffect(() => {
    if (status === 'allowed') loadData();
  }, [status, loadData]);

  const handleDecision = async (row, decision) => {
    setActionError(null);
    setActingId(row.id);

    const catatanReviewer = (noteById[row.id] || '').trim() || null;

    // Whitelist field, penurunan baris master, klaim status, update master,
    // audit log, dan notifikasi semuanya diproses di server (lihat
    // app/api/profile-change-requests/[id]/decision), bukan dari browser.
    try {
      const res = await fetch(`/api/profile-change-requests/${row.id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, catatan: catatanReviewer }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setActionError(body.error || 'Gagal memproses pengajuan, coba lagi.');
        // Bentrok (mis. sudah diproses admin lain): muat ulang biar daftar akurat.
        if (res.status === 409) loadData();
        return;
      }

      setRequests((prev) => prev.map((r) => (r.id === body.request.id ? body.request : r)));
    } catch (err) {
      console.error('Proses pengajuan profil error:', err);
      setActionError('Gagal menghubungi server, coba lagi.');
    } finally {
      setActingId(null);
    }
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

  const visibleRequests = showAll || filterEmployeeId ? requests : requests.filter((r) => r.status === 'pending');
  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      {filterEmployeeId && (
        <Link href={`/employee/list/${filterEmployeeId}`} className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-black mb-6">
          <ArrowLeft size={14} /> Kembali ke {filterEmployeeName || 'Detail Karyawan'}
        </Link>
      )}
      <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">
            {filterEmployeeId ? `Riwayat Perubahan Profil${filterEmployeeName ? ' — ' + filterEmployeeName : ''}` : 'Kelola Perubahan Profil'}
          </h1>
          <p className="text-sm text-[#6B6B6B] mt-1">
            {filterEmployeeId
              ? `${requests.length} pengajuan ditemukan.`
              : pendingCount > 0 ? `${pendingCount} pengajuan menunggu review.` : 'Tidak ada pengajuan yang menunggu.'}
          </p>
        </div>
        {!filterEmployeeId && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-xs text-madael-red hover:text-madael-dark font-medium"
          >
            {showAll ? 'Tampilkan yang pending saja' : 'Tampilkan semua riwayat'}
          </button>
        )}
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
                {getChangeEntries(row).map(([key, change]) => (
                  <div key={key} className="text-sm">
                    <span className="text-[#6B6B6B] text-xs block">
                      {fieldLabel(key)}
                      {!isAllowedProfileField(key) && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium tracking-[0.04em] px-1.5 py-0.5 bg-amber-100 text-amber-800">
                          <AlertTriangle size={10} /> TIDAK DIIZINKAN
                        </span>
                      )}
                    </span>
                    <span className="text-[#9A9A9A] line-through mr-2">{tampilNilai(change?.before)}</span>
                    <span className="text-black font-medium">{tampilNilai(change?.after)}</span>
                  </div>
                ))}
              </div>

              {row.catatan_karyawan && (
                <p className="text-xs text-[#6B6B6B] mb-3">Catatan karyawan: {row.catatan_karyawan}</p>
              )}

              {row.status === 'pending' && !canApprove(row) && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-3 mb-3">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {getBlockedKeys(row).length > 0
                    ? 'Pengajuan ini memuat field yang tidak diizinkan, jadi tidak bisa disetujui. Kamu masih bisa menolaknya.'
                    : 'Pengajuan ini tidak memuat perubahan yang bisa diterapkan, jadi tidak bisa disetujui. Kamu masih bisa menolaknya.'}
                </div>
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
                      disabled={actingId === row.id || !canApprove(row)}
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