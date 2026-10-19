'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { logActivity } from '@/lib/activityLogClient';
import { friendlyError } from '@/lib/errorMessage';
import { formatTanggalWaktu } from '@/lib/peraturanConfig';
import { pesanErrorRevisi, muatNamaKaryawan } from '@/lib/peraturanRevisi';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import ConfirmDialog from '@/components/ConfirmDialog';

// Bagian "Pasal Terhapus" di halaman detail peraturan: pasal yang dihapus dan
// belum dipulihkan, diambil dari riwayat revisi pasal (RPC daftar_pasal_terhapus).
// Dimuat saat dibuka. Baca = semua pemegang flag (RLS); pulihkan = superadmin
// pemegang flag (dicek di dalam RPC pulihkan_pasal_revisi; `canEdit` kosmetik).
//
// refreshToken — ubah nilainya (mis. naik 1 setelah menghapus pasal) agar daftar
// dimuat ulang bila sudah pernah dibuka.
// onRestored() — dipanggil setelah pemulihan berhasil agar daftar pasal dimuat ulang.
export default function PasalTerhapus({ peraturanId, peraturanLabel, canEdit, refreshToken = 0, onRestored }) {
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null); // null = belum dimuat
  const [nama, setNama] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [target, setTarget] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const reqToken = useRef(0);

  const load = useCallback(async () => {
    const token = ++reqToken.current;
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase.rpc('daftar_pasal_terhapus', {
      p_peraturan_id: peraturanId,
    });
    if (token !== reqToken.current) return;
    if (err) {
      setError(friendlyError(err, 'Gagal memuat daftar pasal terhapus.', { context: 'Pasal terhapus' }));
      setLoading(false);
      return;
    }
    const names = await muatNamaKaryawan(supabase, (data || []).map((r) => r.dihapus_oleh));
    if (token !== reqToken.current) return;
    setItems(data || []);
    setNama(names);
    setLoading(false);
  }, [supabase, peraturanId]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && items === null) load();
  };

  // Muat ulang bila ada pasal baru dihapus dan daftar sudah pernah dibuka.
  useEffect(() => {
    if (refreshToken > 0 && items !== null) load();
    // Hanya bereaksi pada perubahan refreshToken.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handlePulihkan = async () => {
    if (!target) return;
    setRestoring(true);
    setActionError('');
    const { data, error: err } = await supabase.rpc('pulihkan_pasal_revisi', {
      p_revisi_id: target.revisi_id,
    });
    setRestoring(false);
    if (err) {
      setActionError(pesanErrorRevisi(err, 'Gagal memulihkan pasal.', 'Pulihkan pasal terhapus'));
      setTarget(null);
      return;
    }

    logActivity({
      aksi: 'pulihkan_revisi_pasal',
      targetTable: 'peraturan_pasal',
      targetId: target.pasal_id,
      detail: {
        peraturan: peraturanLabel,
        peraturan_id: peraturanId,
        pasal: target.nomor_pasal,
        aksi_sumber: 'hapus',
        dari_versi: data?.versi_sumber ?? target.versi,
        versi_baru: data?.versi_baru ?? null,
      },
    });
    setNotice(`Pasal ${target.nomor_pasal} dipulihkan.`);
    setTarget(null);
    await onRestored?.();
    await load();
  };

  return (
    <div className="mt-6 pt-6 border-t border-[#E0E0E0]">
      <button
        type="button"
        onClick={toggleOpen}
        className="inline-flex items-center gap-2 text-sm font-medium text-black hover:text-madael-red"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Trash2 size={14} />
        Pasal Terhapus
        {items && <span className="text-[#9A9A9A] font-normal">({items.length})</span>}
      </button>

      {open && (
        <div className="mt-3">
          {notice && <p className="text-xs text-green-700 mb-3">{notice}</p>}
          {actionError && <p className="text-xs text-red-600 mb-3">{actionError}</p>}

          {loading && <LoadingState label="Memuat pasal terhapus..." />}
          {!loading && error && <ErrorState message={error} onRetry={load} />}
          {!loading && !error && items && items.length === 0 && (
            <EmptyState message="Tidak ada pasal terhapus untuk peraturan ini." />
          )}

          {!loading && !error && items && items.length > 0 && (
            <ul className="border border-[#E0E0E0] divide-y divide-[#E0E0E0] bg-white">
              {items.map((it) => (
                <li key={it.revisi_id} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm font-medium text-black">Pasal {it.nomor_pasal}</span>
                    {it.judul && <span className="text-xs text-[#6B6B6B]">{it.judul}</span>}
                    <span className="text-xs text-[#9A9A9A] ml-auto">
                      Dihapus {formatTanggalWaktu(it.dihapus_pada)}
                      {' · '}
                      {it.dihapus_oleh ? nama[it.dihapus_oleh] || '—' : 'Sistem / SQL Editor'}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => { setActionError(''); setNotice(''); setTarget(it); }}
                        className="inline-flex items-center gap-1.5 border border-[#E0E0E0] px-3 py-1 text-xs text-black hover:border-madael-red hover:text-madael-red transition-colors"
                      >
                        <RotateCcw size={12} />
                        Pulihkan
                      </button>
                    )}
                  </div>
                  {it.cuplikan && (
                    <p className="mt-1 text-xs text-[#6B6B6B] whitespace-pre-line break-words line-clamp-3">
                      {it.cuplikan}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!target}
        title="Pulihkan Pasal"
        message={
          <>
            Buat kembali <strong>Pasal {target?.nomor_pasal}</strong> di <strong>{peraturanLabel}</strong> dengan
            isi terakhir sebelum dihapus? Pemulihan ini tercatat sebagai revisi baru.
          </>
        }
        confirmLabel="Pulihkan"
        busyLabel="Memulihkan..."
        busy={restoring}
        onConfirm={handlePulihkan}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}
