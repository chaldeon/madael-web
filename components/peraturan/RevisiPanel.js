'use client';

import { useCallback, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, History, RotateCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { logActivity } from '@/lib/activityLogClient';
import { friendlyError } from '@/lib/errorMessage';
import { formatTanggalWaktu, labelPeraturan } from '@/lib/peraturanConfig';
import {
  REVISI_KOLOM_ISI, REVISI_KOLOM_PDF, AKSI_REVISI_LABEL, REVISI_LIST_COLUMNS, REVISI_LIMIT,
  selisihSnapshot, ringkasPdf, pesanErrorRevisi, muatNamaKaryawan,
} from '@/lib/peraturanRevisi';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import ConfirmDialog from '@/components/ConfirmDialog';

// Tabel selisih per kolom. Teks panjang (ringkasan) dibatasi tinggi dan bisa digulir.
function TabelSelisih({ selisih }) {
  return (
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
          {selisih.map((s) => (
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
  );
}

// Bagian "Riwayat Revisi" di halaman detail peraturan. Dimuat saat dibuka (bukan
// saat halaman dimuat). Baca = semua pemegang flag (RLS); pulihkan = superadmin
// pemegang flag (dicek di dalam RPC; `canEdit` hanya kosmetik).
export default function RevisiPanel({ row, canEdit, employee, onRestored }) {
  const supabase = createClient();

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null); // null = belum dimuat
  const [nama, setNama] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [expanded, setExpanded] = useState(null); // id revisi yang dibuka
  const [detail, setDetail] = useState({}); // id -> { status, selisih?, info? }

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
      .from('peraturan_revisi')
      .select(REVISI_LIST_COLUMNS)
      .eq('peraturan_id', row.id)
      .order('versi', { ascending: false })
      .limit(REVISI_LIMIT);
    if (token !== reqToken.current) return;
    if (err) {
      setError(friendlyError(err, 'Gagal memuat riwayat revisi.', { context: 'Riwayat revisi peraturan' }));
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
  }, [supabase, row.id]);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && items === null) load();
  };

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
      .from('peraturan_revisi')
      .select('versi, snapshot')
      .eq('peraturan_id', row.id)
      .in('versi', [rev.versi, rev.versi - 1]);
    if (err || !data) {
      if (err) friendlyError(err, 'Gagal memuat rincian revisi.', { context: 'Rincian revisi peraturan' });
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
        selisih: sebelumnya ? selisihSnapshot(sebelumnya, ini, REVISI_KOLOM_ISI) : [],
        pdfBerubah: sebelumnya && ringkasPdf(sebelumnya) !== ringkasPdf(ini)
          ? { sebelum: ringkasPdf(sebelumnya) || '—', sesudah: ringkasPdf(ini) || '—' }
          : null,
      },
    }));
  };

  // Ambil snapshot revisi, bandingkan dengan isi saat ini, lalu minta konfirmasi.
  const mintaPulihkan = async (rev) => {
    setActionError('');
    setNotice('');
    setBusyId(rev.id);
    const { data, error: err } = await supabase
      .from('peraturan_revisi')
      .select('snapshot')
      .eq('id', rev.id)
      .maybeSingle();
    setBusyId(null);
    if (err || !data) {
      setActionError(
        err ? friendlyError(err, 'Gagal memuat revisi.', { context: 'Pulihkan revisi peraturan' }) : 'Revisi tidak ditemukan.'
      );
      return;
    }
    const selisih = selisihSnapshot(row, data.snapshot, REVISI_KOLOM_ISI);
    if (selisih.length === 0) {
      setNotice(`Isi peraturan sudah sama dengan versi ${rev.versi}; tidak ada yang perlu dipulihkan.`);
      return;
    }
    setTarget({ rev, selisih });
  };

  const handlePulihkan = async () => {
    if (!target) return;
    setRestoring(true);
    setActionError('');
    const { data, error: err } = await supabase.rpc('pulihkan_peraturan_revisi', {
      p_revisi_id: target.rev.id,
    });
    setRestoring(false);
    if (err) {
      setActionError(pesanErrorRevisi(err, 'Gagal memulihkan revisi.', 'Pulihkan revisi peraturan'));
      setTarget(null);
      return;
    }

    logActivity({
      aksi: 'pulihkan_revisi_peraturan',
      targetTable: 'peraturan',
      targetId: row.id,
      detail: {
        peraturan: labelPeraturan(row),
        judul: row.judul,
        dari_versi: data?.versi_sumber ?? target.rev.versi,
        versi_baru: data?.versi_baru ?? null,
        kolom_berubah: target.selisih.map((s) => s.key),
      },
    });
    setTarget(null);
    setNotice(`Isi dipulihkan ke versi ${target.rev.versi}${data?.versi_baru ? ` (tercatat sebagai versi ${data.versi_baru})` : ''}.`);
    await onRestored?.();
    await load();
  };

  const versiById = new Map((items || []).map((r) => [r.id, r.versi]));
  const terbaru = items?.[0]?.id;

  return (
    <div className="mt-6 pt-6 border-t border-[#E0E0E0]">
      <button
        type="button"
        onClick={toggleOpen}
        className="inline-flex items-center gap-2 text-sm font-medium text-black hover:text-madael-red"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <History size={14} />
        Riwayat Revisi
      </button>

      {open && (
        <div className="mt-3">
          {notice && <p className="text-xs text-green-700 mb-3">{notice}</p>}
          {actionError && <p className="text-xs text-red-600 mb-3">{actionError}</p>}

          {loading && <LoadingState label="Memuat riwayat..." />}
          {!loading && error && <ErrorState message={error} onRetry={load} />}
          {!loading && !error && items && items.length === 0 && (
            <EmptyState message="Belum ada riwayat revisi." />
          )}

          {!loading && !error && items && items.length > 0 && (
            <>
              <ul className="border border-[#E0E0E0] divide-y divide-[#E0E0E0]">
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
                                    ? 'Keadaan saat riwayat diaktifkan. Tidak ada versi sebelumnya untuk dibandingkan.'
                                    : 'Versi pertama. Tidak ada versi sebelumnya untuk dibandingkan.'}
                                </p>
                              )}
                              {!d.pertama && rev.aksi === 'hapus' && (
                                <p className="text-xs text-[#6B6B6B]">
                                  Peraturan dihapus beserta {rev.jumlah_relasi ?? 0} relasi dan {rev.jumlah_pasal ?? 0} pasal.
                                  Pemulihan lewat halaman Terhapus di daftar peraturan.
                                </p>
                              )}
                              {!d.pertama && rev.aksi !== 'hapus' && d.selisih.length > 0 && (
                                <TabelSelisih selisih={d.selisih} />
                              )}
                              {!d.pertama && rev.aksi !== 'hapus' && d.selisih.length === 0 && !d.pdfBerubah && (
                                <p className="text-xs text-[#6B6B6B]">
                                  Tidak ada perubahan isi yang terlihat (mis. hanya urutan topik/keyword berubah).
                                </p>
                              )}
                              {d.pdfBerubah && (
                                <p className="text-xs text-[#6B6B6B] mt-2">
                                  {REVISI_KOLOM_PDF[0].label}: {d.pdfBerubah.sebelum} → {d.pdfBerubah.sesudah}
                                </p>
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
                ditimpa. Berkas PDF unggahan, relasi, dan pasal tidak ikut dikembalikan saat memulihkan versi lama.
              </p>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!target}
        title="Pulihkan Versi"
        message={
          <>
            Kembalikan isi <strong>{labelPeraturan(row)}</strong> ke versi <strong>{target?.rev.versi}</strong>?
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
