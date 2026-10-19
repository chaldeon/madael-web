'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { logActivity } from '@/lib/activityLogClient';
import { friendlyError } from '@/lib/errorMessage';
import { formatTanggalWaktu } from '@/lib/peraturanConfig';
import {
  AKSI_REVISI_LABEL, REVISI_LIMIT, selisihSnapshot, pesanErrorRevisi, muatNamaKaryawan,
} from '@/lib/peraturanRevisi';
import { PASAL_REVISI_KOLOM, PASAL_REVISI_LIST_COLUMNS, diffKata } from '@/lib/pasalRevisi';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import ConfirmDialog from '@/components/ConfirmDialog';

// Teks dengan bagian yang berubah diberi penanda. Warna tidak jadi satu-satunya
// pembeda: yang dihapus dicoret, yang ditambah digarisbawahi.
function TeksDiff({ segmen, jenis }) {
  const kelas = jenis === 'hapus'
    ? 'bg-red-100 text-red-900 line-through'
    : 'bg-green-100 text-green-900 underline';
  return segmen.map((s, i) =>
    s.ubah ? <mark key={i} className={kelas}>{s.teks}</mark> : <span key={i}>{s.teks}</span>
  );
}

// Selisih satu versi terhadap versi sebelumnya: kolom pendek dalam tabel, isi
// pasal dalam dua kotak berdampingan dengan penanda per kata.
function SelisihPasal({ selisih }) {
  const isi = selisih.find((s) => s.key === 'isi');
  const lain = selisih.filter((s) => s.key !== 'isi');
  const diff = useMemo(() => (isi ? diffKata(isi.sebelum, isi.sesudah) : null), [isi]);

  return (
    <div className="space-y-3">
      {lain.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border border-[#E0E0E0]">
            <thead>
              <tr className="bg-[#F4F4F4] text-left text-[#6B6B6B]">
                <th className="px-2 py-1.5 font-medium w-[22%]">Kolom</th>
                <th className="px-2 py-1.5 font-medium w-[39%]">Sebelum</th>
                <th className="px-2 py-1.5 font-medium w-[39%]">Sesudah</th>
              </tr>
            </thead>
            <tbody>
              {lain.map((s) => (
                <tr key={s.key} className="border-t border-[#E0E0E0] align-top">
                  <td className="px-2 py-1.5 text-[#3D3D3D]">{s.label}</td>
                  <td className="px-2 py-1.5 text-[#3D3D3D]">
                    <div className="max-h-32 overflow-auto whitespace-pre-line break-words">{s.sebelum}</div>
                  </td>
                  <td className="px-2 py-1.5 text-black">
                    <div className="max-h-32 overflow-auto whitespace-pre-line break-words">{s.sesudah}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isi && diff && (
        <div>
          <p className="text-xs font-medium text-[#6B6B6B] mb-1">{isi.label}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="border border-[#E0E0E0]">
              <p className="bg-[#F4F4F4] px-2 py-1 text-[11px] font-medium text-[#6B6B6B]">Sebelum</p>
              <p className="px-2 py-1.5 text-xs text-[#3D3D3D] leading-relaxed max-h-64 overflow-auto whitespace-pre-line break-words">
                <TeksDiff segmen={diff.sebelum} jenis="hapus" />
              </p>
            </div>
            <div className="border border-[#E0E0E0]">
              <p className="bg-[#F4F4F4] px-2 py-1 text-[11px] font-medium text-[#6B6B6B]">Sesudah</p>
              <p className="px-2 py-1.5 text-xs text-black leading-relaxed max-h-64 overflow-auto whitespace-pre-line break-words">
                <TeksDiff segmen={diff.sesudah} jenis="tambah" />
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Riwayat revisi SATU pasal, dirender di bawah pasal yang dibuka di PasalList.
// Dimuat saat dipasang (PasalList hanya merendernya setelah tombol Riwayat
// diklik). Baca = semua pemegang flag (RLS); pulihkan = superadmin pemegang flag
// (dicek di dalam RPC pulihkan_pasal_revisi; `canEdit` hanya kosmetik).
//
// row = isi pasal saat ini (baris lengkap), dipakai membandingkan sebelum memulihkan.
// onRestored(pasalId) — dipanggil setelah pemulihan berhasil agar PasalList menyegarkan pasalnya.
export default function PasalRiwayat({ pasalId, peraturanId, peraturanLabel, row, canEdit, onRestored }) {
  const supabase = createClient();

  const [items, setItems] = useState(null); // null = belum dimuat
  const [nama, setNama] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [expanded, setExpanded] = useState(null); // id revisi yang dibuka
  const [detail, setDetail] = useState({}); // id -> { status, pertama?, selisih? }

  const [target, setTarget] = useState(null); // { rev, selisih } menunggu konfirmasi
  const [busyId, setBusyId] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const reqToken = useRef(0);

  const load = useCallback(async () => {
    const token = ++reqToken.current;
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase
      .from('peraturan_pasal_revisi')
      .select(PASAL_REVISI_LIST_COLUMNS)
      .eq('pasal_id', pasalId)
      .order('versi', { ascending: false })
      .limit(REVISI_LIMIT);
    if (token !== reqToken.current) return;
    if (err) {
      setError(friendlyError(err, 'Gagal memuat riwayat pasal.', { context: 'Riwayat revisi pasal' }));
      setLoading(false);
      return;
    }
    const names = await muatNamaKaryawan(supabase, (data || []).map((r) => r.diubah_oleh));
    if (token !== reqToken.current) return;
    setItems(data || []);
    setNama(names);
    setDetail({});
    setExpanded(null);
    setLoading(false);
  }, [supabase, pasalId]);

  useEffect(() => {
    load();
  }, [load]);

  // Selisih versi ini terhadap versi sebelumnya (butuh dua snapshot).
  const toggleItem = async (rev) => {
    if (expanded === rev.id) {
      setExpanded(null);
      return;
    }
    setExpanded(rev.id);
    if (detail[rev.id]?.status === 'ok') return;

    setDetail((prev) => ({ ...prev, [rev.id]: { status: 'loading' } }));
    const { data, error: err } = await supabase
      .from('peraturan_pasal_revisi')
      .select('versi, snapshot')
      .eq('pasal_id', pasalId)
      .in('versi', [rev.versi, rev.versi - 1]);
    if (err || !data) {
      if (err) friendlyError(err, 'Gagal memuat rincian revisi pasal.', { context: 'Rincian revisi pasal' });
      setDetail((prev) => ({ ...prev, [rev.id]: { status: 'error' } }));
      return;
    }
    const ini = data.find((d) => d.versi === rev.versi)?.snapshot;
    const sebelumnya = data.find((d) => d.versi === rev.versi - 1)?.snapshot;
    setDetail((prev) => ({
      ...prev,
      [rev.id]: {
        status: 'ok',
        pertama: !sebelumnya,
        selisih: sebelumnya ? selisihSnapshot(sebelumnya, ini, PASAL_REVISI_KOLOM) : [],
      },
    }));
  };

  // Ambil snapshot revisi, bandingkan dengan isi saat ini, lalu minta konfirmasi.
  const mintaPulihkan = async (rev) => {
    setActionError('');
    setNotice('');
    setBusyId(rev.id);
    const { data, error: err } = await supabase
      .from('peraturan_pasal_revisi')
      .select('snapshot')
      .eq('id', rev.id)
      .maybeSingle();
    setBusyId(null);
    if (err || !data) {
      setActionError(
        err ? friendlyError(err, 'Gagal memuat revisi.', { context: 'Pulihkan revisi pasal' }) : 'Revisi tidak ditemukan.'
      );
      return;
    }
    const selisih = selisihSnapshot(row, data.snapshot, PASAL_REVISI_KOLOM);
    if (selisih.length === 0) {
      setNotice(`Isi pasal sudah sama dengan versi ${rev.versi}; tidak ada yang perlu dipulihkan.`);
      return;
    }
    setTarget({ rev, selisih });
  };

  const handlePulihkan = async () => {
    if (!target) return;
    setRestoring(true);
    setActionError('');
    const { data, error: err } = await supabase.rpc('pulihkan_pasal_revisi', {
      p_revisi_id: target.rev.id,
    });
    setRestoring(false);
    if (err) {
      setActionError(pesanErrorRevisi(err, 'Gagal memulihkan pasal.', 'Pulihkan revisi pasal'));
      setTarget(null);
      return;
    }

    logActivity({
      aksi: 'pulihkan_revisi_pasal',
      targetTable: 'peraturan_pasal',
      targetId: pasalId,
      detail: {
        peraturan: peraturanLabel,
        peraturan_id: peraturanId,
        pasal: row?.nomor_pasal,
        dari_versi: data?.versi_sumber ?? target.rev.versi,
        versi_baru: data?.versi_baru ?? null,
        kolom_berubah: target.selisih.map((s) => s.key),
      },
    });
    setTarget(null);
    setNotice(`Isi pasal dipulihkan ke versi ${target.rev.versi}${data?.versi_baru ? ` (tercatat sebagai versi ${data.versi_baru})` : ''}.`);
    await onRestored?.(pasalId);
    await load();
  };

  const versiById = new Map((items || []).map((r) => [r.id, r.versi]));
  const terbaru = items?.[0]?.id;

  return (
    <div className="mt-4 pt-3 border-t border-[#F0F0F0]">
      <h3 className="text-xs font-medium text-black mb-2">Riwayat Pasal</h3>

      {notice && <p className="text-xs text-green-700 mb-2">{notice}</p>}
      {actionError && <p className="text-xs text-red-600 mb-2">{actionError}</p>}

      {loading && <LoadingState label="Memuat riwayat..." />}
      {!loading && error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && items && items.length === 0 && (
        <EmptyState message="Belum ada riwayat untuk pasal ini." />
      )}

      {!loading && !error && items && items.length > 0 && (
        <>
          <ul className="border border-[#E0E0E0] divide-y divide-[#E0E0E0] bg-white">
            {items.map((rev) => {
              const isOpen = expanded === rev.id;
              const d = detail[rev.id];
              const dariVersi = rev.sumber_revisi_id ? versiById.get(rev.sumber_revisi_id) : null;
              return (
                <li key={rev.id}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleItem(rev)}
                      className="inline-flex items-center gap-2 text-sm text-black hover:text-madael-red text-left"
                      aria-expanded={isOpen}
                    >
                      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      <span className="font-medium">Versi {rev.versi}</span>
                      <span className="text-[#3D3D3D]">{AKSI_REVISI_LABEL[rev.aksi] || rev.aksi}</span>
                    </button>
                    {rev.id === terbaru && (
                      <span className="text-[10px] font-medium uppercase tracking-[0.04em] px-2 py-0.5 bg-[#F4F4F4] text-[#6B6B6B]">
                        Saat ini
                      </span>
                    )}
                    {rev.sumber_revisi_id && (
                      <span className="text-xs text-[#6B6B6B]">
                        dipulihkan{dariVersi ? ` dari versi ${dariVersi}` : ' dari revisi lain'}
                      </span>
                    )}
                    <span className="text-xs text-[#9A9A9A] ml-auto">
                      {formatTanggalWaktu(rev.diubah_pada)}
                      {' · '}
                      {rev.diubah_oleh ? nama[rev.diubah_oleh] || '—' : 'Sistem / SQL Editor'}
                    </span>
                    {canEdit && rev.id !== terbaru && rev.aksi !== 'hapus' && (
                      <button
                        type="button"
                        onClick={() => mintaPulihkan(rev)}
                        disabled={busyId === rev.id}
                        className="inline-flex items-center gap-1.5 border border-[#E0E0E0] px-3 py-1 text-xs text-black hover:border-madael-red hover:text-madael-red transition-colors disabled:opacity-50"
                      >
                        <RotateCcw size={12} />
                        {busyId === rev.id ? 'Memuat...' : 'Pulihkan versi ini'}
                      </button>
                    )}
                  </div>

                  {isOpen && (
                    <div className="px-3 pb-3">
                      {(!d || d.status === 'loading') && <LoadingState label="Memuat rincian..." />}
                      {d?.status === 'error' && (
                        <p className="text-xs text-red-600">Gagal memuat rincian revisi.</p>
                      )}
                      {d?.status === 'ok' && (
                        <>
                          {d.pertama && (
                            <p className="text-xs text-[#6B6B6B]">
                              {rev.aksi === 'awal'
                                ? 'Keadaan saat riwayat pasal diaktifkan. Tidak ada versi sebelumnya untuk dibandingkan.'
                                : 'Versi pertama. Tidak ada versi sebelumnya untuk dibandingkan.'}
                            </p>
                          )}
                          {!d.pertama && rev.aksi === 'hapus' && (
                            <p className="text-xs text-[#6B6B6B]">
                              Pasal dihapus pada versi ini. Isinya sama dengan versi sebelumnya.
                            </p>
                          )}
                          {!d.pertama && rev.aksi !== 'hapus' && d.selisih.length > 0 && (
                            <SelisihPasal selisih={d.selisih} />
                          )}
                          {!d.pertama && rev.aksi !== 'hapus' && d.selisih.length === 0 && (
                            <p className="text-xs text-[#6B6B6B]">Tidak ada perubahan isi yang terlihat.</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-[#9A9A9A] mt-2">
            Menampilkan maksimal {REVISI_LIMIT} revisi terbaru. Memulihkan versi lama menambah revisi baru; riwayat tidak
            ditimpa.
          </p>
        </>
      )}

      <ConfirmDialog
        open={!!target}
        title="Pulihkan Versi Pasal"
        message={
          <>
            Kembalikan <strong>Pasal {row?.nomor_pasal}</strong> ke versi <strong>{target?.rev.versi}</strong>?
            Kolom yang akan berubah: <strong>{target?.selisih.map((s) => s.label).join(', ')}</strong>.
            Versi saat ini tetap tersimpan di riwayat.
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
