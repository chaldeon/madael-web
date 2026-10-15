'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { logActivity } from '@/lib/activityLogClient';
import { friendlyError } from '@/lib/errorMessage';
import { PERATURAN_MODULE_KEY, formatTanggalWaktu, labelPeraturan } from '@/lib/peraturanConfig';
import { pesanErrorRevisi, muatNamaKaryawan } from '@/lib/peraturanRevisi';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import ConfirmDialog from '@/components/ConfirmDialog';
import { StatusBadge } from '@/components/peraturan/PeraturanParts';

// Peraturan yang sudah dihapus tetapi riwayatnya masih tersimpan. Baca = semua
// pemegang flag; pulihkan = superadmin pemegang flag (dicek di dalam RPC).
export default function PeraturanTerhapusPage() {
  const supabase = createClient();
  const router = useRouter();
  const { employee } = useModuleAccess(PERATURAN_MODULE_KEY);
  const canEdit = !!employee?.is_superadmin; // kosmetik; RPC yang menegakkan

  const [items, setItems] = useState([]);
  const [nama, setNama] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [target, setTarget] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase.rpc('daftar_peraturan_terhapus');
    if (err) {
      setError(friendlyError(err, 'Gagal memuat daftar peraturan terhapus.', { context: 'Daftar peraturan terhapus' }));
      setLoading(false);
      return;
    }
    const list = data || [];
    setNama(await muatNamaKaryawan(supabase, list.map((r) => r.dihapus_oleh)));
    setItems(list);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePulihkan = async () => {
    if (!target) return;
    setRestoring(true);
    setActionError('');
    const { data, error: err } = await supabase.rpc('pulihkan_peraturan_revisi', {
      p_revisi_id: target.revisi_id,
    });
    setRestoring(false);
    if (err) {
      setActionError(pesanErrorRevisi(err, 'Gagal memulihkan peraturan.', 'Pulihkan peraturan terhapus'));
      setTarget(null);
      return;
    }

    logActivity({
      aksi: 'pulihkan_revisi_peraturan',
      targetTable: 'peraturan',
      targetId: target.peraturan_id,
      detail: {
        peraturan: labelPeraturan(target),
        judul: target.judul,
        dari_versi: data?.versi_sumber ?? target.versi,
        versi_baru: data?.versi_baru ?? null,
        pemulihan: 'peraturan_terhapus',
        relasi_dipulihkan: data?.relasi_dipulihkan ?? 0,
        relasi_dilewati: data?.relasi_dilewati ?? 0,
        pasal_dipulihkan: data?.pasal_dipulihkan ?? 0,
      },
    });
    router.push(`/employee/peraturan/${target.peraturan_id}`);
  };

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <Link
        href="/employee/peraturan"
        className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-black mb-6"
      >
        <ArrowLeft size={14} />
        Kembali ke daftar
      </Link>

      <div className="flex items-center gap-2 mb-1">
        <Trash2 size={18} className="text-madael-red" />
        <h1 className="text-2xl font-semibold text-black">Peraturan Terhapus</h1>
      </div>
      <p className="text-sm text-[#6B6B6B] mb-6">
        Peraturan yang dihapus tersimpan di riwayat dan bisa dipulihkan beserta relasi dan pasalnya. Berkas PDF yang
        diunggah ke Drive tidak ikut dipulihkan karena dihapus bersama peraturannya.
      </p>

      {actionError && <p className="text-xs text-red-600 mb-4">{actionError}</p>}

      {loading && <LoadingState label="Memuat..." />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && items.length === 0 && (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Tidak ada peraturan yang terhapus." />
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="bg-white border border-[#E0E0E0] divide-y divide-[#E0E0E0]">
          {items.map((r) => (
            <li key={r.revisi_id} className="p-4 flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-[220px]">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-madael-red tracking-[0.04em] uppercase">{labelPeraturan(r)}</span>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-sm text-black break-words">{r.judul}</p>
                <p className="text-[11px] text-[#9A9A9A] mt-1">
                  Dihapus {formatTanggalWaktu(r.dihapus_pada)}
                  {' · '}
                  {r.dihapus_oleh ? nama[r.dihapus_oleh] || '—' : 'Sistem / SQL Editor'}
                  {' · '}
                  {r.jumlah_relasi} relasi, {r.jumlah_pasal} pasal
                </p>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => { setActionError(''); setTarget(r); }}
                  className="inline-flex items-center gap-2 border border-[#E0E0E0] px-4 py-2 text-sm text-black hover:border-madael-red hover:text-madael-red transition-colors"
                >
                  <RotateCcw size={14} />
                  Pulihkan
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!target}
        title="Pulihkan Peraturan"
        message={
          <>
            Pulihkan <strong>{target ? labelPeraturan(target) : ''}</strong> beserta {target?.jumlah_relasi ?? 0} relasi dan{' '}
            {target?.jumlah_pasal ?? 0} pasal? Relasi ke peraturan yang sudah tidak ada dilewati. Berkas PDF unggahan tidak
            ikut dipulihkan.
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
