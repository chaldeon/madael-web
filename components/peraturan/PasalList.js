'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, History, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { logActivity } from '@/lib/activityLogClient';
import { friendlyError } from '@/lib/errorMessage';
import { fetchAllRows } from '@/lib/fetchAllRows';
import {
  PASAL_LIST_COLUMNS, PASAL_DETAIL_COLUMNS, PASAL_PAGE_SIZE, labelPasal, pasalAnchor, formatTanggalWaktu,
} from '@/lib/peraturanConfig';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import ConfirmDialog from '@/components/ConfirmDialog';
import PasalForm from '@/components/peraturan/PasalForm';
import PasalRiwayat from '@/components/peraturan/PasalRiwayat';
import PasalTerhapus from '@/components/peraturan/PasalTerhapus';

const SEARCH_MIN_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_LIMIT = 200;
const DETAIL_SELECT = `${PASAL_DETAIL_COLUMNS}, pengubah:updated_by ( nama )`;

// Mode baca isi pasal: ukuran teks dipilih pembaca dan diingat di browser ini.
// Lebar baris dibatasi ±70 karakter (satuan ch ikut membesar bersama teks).
const UKURAN_TEKS = [
  { key: 'normal', label: 'normal', className: 'text-base' },
  { key: 'besar', label: 'besar', className: 'text-lg' },
  { key: 'terbesar', label: 'sangat besar', className: 'text-xl' },
];
const UKURAN_TEKS_STORAGE_KEY = 'peraturan-pasal-ukuran-teks';

function bacaUkuranTersimpan() {
  try {
    const saved = window.localStorage.getItem(UKURAN_TEKS_STORAGE_KEY);
    return UKURAN_TEKS.some((u) => u.key === saved) ? saved : null;
  } catch {
    return null; // penyimpanan diblokir: pakai ukuran bawaan
  }
}

function sortItems(list) {
  return [...list].sort(
    (a, b) =>
      a.urutan - b.urutan ||
      a.nomor_pasal.localeCompare(b.nomor_pasal, 'id', { numeric: true, sensitivity: 'base' })
  );
}

const headerOf = (row) => ({ id: row.id, nomor_pasal: row.nomor_pasal, urutan: row.urutan, judul: row.judul });

// Bagian "Pasal" di halaman detail peraturan. Daftar hanya memuat header
// (nomor + bab/bagian); isi dimuat saat sebuah pasal dibuka, jadi UU dengan
// ratusan pasal tetap ringan. Hak tulis ditegakkan RLS; `canEdit` kosmetik.
export default function PasalList({ peraturanId, peraturanLabel, canEdit, employee }) {
  const supabase = createClient();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [searchResult, setSearchResult] = useState(null); // { term, ids: Set } hasil RPC terakhir
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchToken = useRef(0);
  const term = q.trim().slice(0, 100);
  const searchActive = term.length >= SEARCH_MIN_LENGTH;
  // Hasil hanya dipakai bila cocok dengan istilah yang sedang diketik.
  const matchIds = searchActive && searchResult?.term === term ? searchResult.ids : null;

  const [visible, setVisible] = useState(PASAL_PAGE_SIZE);
  const [expanded, setExpanded] = useState(() => new Set());
  const [details, setDetails] = useState({}); // id -> { status: 'loading' | 'ok' | 'error', row? }
  const detailsRef = useRef({});
  useEffect(() => {
    detailsRef.current = details;
  }, [details]);

  const [riwayat, setRiwayat] = useState(() => new Set()); // id pasal yang riwayatnya dibuka
  const [terhapusToken, setTerhapusToken] = useState(0); // naik tiap pasal dihapus -> daftar Pasal Terhapus dimuat ulang
  const [form, setForm] = useState(null); // null | { mode: 'new' } | { mode: 'edit', row }
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');

  // Ukuran teks isi pasal. Komponen ini hanya dirender setelah data peraturan
  // dimuat di browser (halaman detail menampilkan LoadingState saat SSR), jadi
  // aman membaca penyimpanan langsung saat inisialisasi.
  const [ukuranKey, setUkuranKey] = useState(() => (typeof window === 'undefined' ? null : bacaUkuranTersimpan()) || 'normal');
  const ukuranIdx = Math.max(0, UKURAN_TEKS.findIndex((u) => u.key === ukuranKey));
  const ukuran = UKURAN_TEKS[ukuranIdx];

  const ubahUkuran = (arah) => {
    const next = UKURAN_TEKS[Math.min(UKURAN_TEKS.length - 1, Math.max(0, ukuranIdx + arah))];
    setUkuranKey(next.key);
    try {
      window.localStorage.setItem(UKURAN_TEKS_STORAGE_KEY, next.key);
    } catch {
      // abaikan: ukuran tetap berlaku untuk sesi ini
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: err } = await fetchAllRows(() =>
      supabase
        .from('peraturan_pasal')
        .select(PASAL_LIST_COLUMNS)
        .eq('peraturan_id', peraturanId)
        .order('urutan', { ascending: true })
    );
    if (err) {
      setError(friendlyError(err, 'Gagal memuat daftar pasal.', { context: 'Daftar pasal' }));
      setLoading(false);
      return;
    }
    setItems(sortItems(data));
    setLoading(false);
  }, [supabase, peraturanId]);

  useEffect(() => {
    load();
  }, [load]);

  // Ambil isi lengkap satu pasal (cache per id). Return baris atau null.
  const fetchDetail = useCallback(async (id, { force = false } = {}) => {
    const cached = detailsRef.current[id];
    if (!force && cached?.status === 'ok') return cached.row;

    setDetails((prev) => ({ ...prev, [id]: { status: 'loading' } }));
    const { data, error: err } = await supabase
      .from('peraturan_pasal')
      .select(DETAIL_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (err || !data) {
      if (err) friendlyError(err, 'Gagal memuat isi pasal.', { context: 'Detail pasal' });
      setDetails((prev) => ({ ...prev, [id]: { status: 'error' } }));
      return null;
    }
    setDetails((prev) => ({ ...prev, [id]: { status: 'ok', row: data } }));
    return data;
  }, [supabase]);

  const toggle = (id) => {
    const isOpen = expanded.has(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (isOpen) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!isOpen && !detailsRef.current[id]) fetchDetail(id);
  };

  // Tautan langsung #pasal-<nomor>: buka pasalnya lalu gulir ke sana.
  const openFromHash = useCallback(() => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#/, '');
    if (!hash.startsWith('pasal-')) return;
    const idx = items.findIndex((it) => pasalAnchor(it.nomor_pasal) === hash);
    if (idx === -1) return;
    const target = items[idx];
    setVisible((v) => Math.max(v, idx + 1));
    setExpanded((prev) => new Set(prev).add(target.id));
    if (!detailsRef.current[target.id]) fetchDetail(target.id);
    setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }, [items, fetchDetail]);

  const hashHandled = useRef(false);
  useEffect(() => {
    if (loading || hashHandled.current) return;
    hashHandled.current = true;
    openFromHash();
  }, [loading, openFromHash]);

  useEffect(() => {
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, [openFromHash]);

  // Pencarian (RPC cari_pasal, dibatasi ke peraturan ini). Hasil memfilter daftar.
  useEffect(() => {
    if (!searchActive) {
      searchToken.current += 1; // batalkan pencarian yang masih berjalan
      return undefined;
    }

    const token = ++searchToken.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      const { data, error: err } = await supabase.rpc('cari_pasal', {
        p_q: term,
        p_peraturan_id: peraturanId,
        p_limit: SEARCH_LIMIT,
      });
      if (token !== searchToken.current) return; // sudah ada pencarian yang lebih baru
      setSearching(false);
      if (err) {
        setSearchError(friendlyError(err, 'Pencarian pasal gagal.', { context: 'Cari pasal' }));
        setSearchResult(null);
        return;
      }
      setSearchError('');
      setSearchResult({ term, ids: new Set((data || []).map((r) => r.id)) });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchActive, term, supabase, peraturanId]);

  const shown = useMemo(() => (matchIds ? items.filter((it) => matchIds.has(it.id)) : items), [items, matchIds]);
  const slice = matchIds ? shown : shown.slice(0, visible);
  const nextUrutan = items.length ? Math.max(...items.map((it) => it.urutan)) + 1 : 1;

  const startEdit = async (item) => {
    setActionError('');
    const row = await fetchDetail(item.id);
    if (!row) {
      setActionError('Isi pasal gagal dimuat, jadi belum bisa diubah. Coba lagi.');
      return;
    }
    setForm({ mode: 'edit', row });
  };

  const handleSaved = (row, { again }) => {
    const header = headerOf(row);
    setItems((prev) => sortItems([...prev.filter((it) => it.id !== row.id), header]));
    setDetails((prev) => ({
      ...prev,
      [row.id]: { status: 'ok', row: { ...row, pengubah: { nama: employee?.nama } } },
    }));
    // Pasal baru/yang baru diubah langsung terlihat.
    setExpanded((prev) => new Set(prev).add(row.id));
    setVisible((v) => Math.max(v, items.length + 1));
    setQ('');
    setForm(again ? { mode: 'new', key: row.id } : null);
  };

  const toggleRiwayat = (id) => {
    setRiwayat((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Setelah sebuah versi dipulihkan: segarkan isi dan header pasal itu tanpa
  // memuat ulang seluruh daftar (panel riwayat tetap terpasang).
  const handleRestored = async (id) => {
    const { data, error: err } = await supabase
      .from('peraturan_pasal')
      .select(DETAIL_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (err || !data) {
      load();
      return;
    }
    setDetails((prev) => ({ ...prev, [id]: { status: 'ok', row: data } }));
    setItems((prev) => sortItems([...prev.filter((it) => it.id !== id), headerOf(data)]));
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError('');

    // Hapus bersifat permanen: simpan isi lengkap ke log aktivitas sebagai cadangan.
    const snapshot = await fetchDetail(deleteTarget.id, { force: true });
    if (!snapshot) {
      setDeleting(false);
      setDeleteTarget(null);
      setActionError('Pasal tidak dihapus: isinya gagal dimuat untuk dicadangkan ke log. Coba lagi.');
      return;
    }

    const { data, error: err } = await supabase
      .from('peraturan_pasal')
      .delete()
      .eq('id', deleteTarget.id)
      .select('id');
    setDeleting(false);
    setDeleteTarget(null);

    if (err) {
      setActionError(friendlyError(err, 'Gagal menghapus pasal.', { context: 'Hapus pasal' }));
      return;
    }
    if (!data || data.length === 0) {
      setActionError('Pasal tidak terhapus: kamu tidak punya izin, atau pasalnya sudah tidak ada.');
      return;
    }

    logActivity({
      aksi: 'hapus_pasal_peraturan',
      targetTable: 'peraturan_pasal',
      targetId: snapshot.id,
      detail: {
        peraturan: peraturanLabel,
        peraturan_id: peraturanId,
        pasal: snapshot.nomor_pasal,
        urutan: snapshot.urutan,
        judul: snapshot.judul,
        isi: snapshot.isi,
        catatan: snapshot.catatan,
      },
    });
    setItems((prev) => prev.filter((it) => it.id !== snapshot.id));
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(snapshot.id);
      return next;
    });
    setRiwayat((prev) => {
      const next = new Set(prev);
      next.delete(snapshot.id);
      return next;
    });
    setTerhapusToken((n) => n + 1);
  };

  return (
    <div className="mt-6 pt-6 border-t border-[#E0E0E0]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-medium text-black">
          Pasal {!loading && !error && <span className="text-[#9A9A9A] font-normal">({items.length})</span>}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          {!loading && !error && items.length > 0 && (
            <div className="inline-flex items-center border border-[#E0E0E0] bg-white" role="group" aria-label="Ukuran teks isi pasal">
              <button
                type="button"
                onClick={() => ubahUkuran(-1)}
                disabled={ukuranIdx === 0}
                aria-label="Perkecil teks isi pasal"
                title="Perkecil teks"
                className="min-w-9 h-9 px-2 text-xs text-black hover:text-madael-red disabled:opacity-40 disabled:hover:text-black transition-colors"
              >
                A−
              </button>
              <span className="px-2 text-[11px] text-[#6B6B6B] border-x border-[#E0E0E0] h-9 inline-flex items-center" aria-live="polite">
                Teks {ukuran.label}
              </span>
              <button
                type="button"
                onClick={() => ubahUkuran(1)}
                disabled={ukuranIdx === UKURAN_TEKS.length - 1}
                aria-label="Perbesar teks isi pasal"
                title="Perbesar teks"
                className="min-w-9 h-9 px-2 text-base text-black hover:text-madael-red disabled:opacity-40 disabled:hover:text-black transition-colors"
              >
                A+
              </button>
            </div>
          )}
          {canEdit && !form && (
            <button
              type="button"
              onClick={() => { setActionError(''); setForm({ mode: 'new' }); }}
              className="inline-flex items-center gap-2 border border-[#E0E0E0] px-3 py-1.5 text-sm text-black hover:border-madael-red hover:text-madael-red transition-colors"
            >
              <Plus size={14} />
              Tambah Pasal
            </button>
          )}
        </div>
      </div>

      {actionError && <p className="text-xs text-red-600 mb-3">{actionError}</p>}

      {form?.mode === 'new' && (
        <PasalForm
          key={form.key || 'new'}
          peraturanId={peraturanId}
          peraturanLabel={peraturanLabel}
          nextUrutan={nextUrutan}
          employee={employee}
          onSaved={handleSaved}
          onCancel={() => setForm(null)}
        />
      )}

      {loading ? (
        <LoadingState label="Memuat pasal..." />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <div className="border border-[#E0E0E0]">
          <EmptyState message={canEdit ? 'Belum ada pasal. Klik "Tambah Pasal" untuk mulai menginput.' : 'Belum ada pasal untuk peraturan ini.'} />
        </div>
      ) : (
        <>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9A9A9A]" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari nomor pasal atau isi pasal..."
              aria-label="Cari pasal"
              className="w-full border border-[#E0E0E0] pl-9 pr-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
            />
          </div>
          {searchError && <p className="text-xs text-red-600 mb-3">{searchError}</p>}
          {searchActive && (searching || matchIds) && (
            <p className="text-xs text-[#6B6B6B] mb-3">
              {searching ? 'Mencari...' : `${shown.length} pasal cocok.`}
            </p>
          )}

          {matchIds && shown.length === 0 ? (
            <div className="border border-[#E0E0E0]">
              <EmptyState message="Tidak ada pasal yang cocok." icon={Search} />
            </div>
          ) : (
            <ul className="space-y-2">
              {slice.map((item, index) => {
                const anchor = pasalAnchor(item.nomor_pasal);
                const isOpen = expanded.has(item.id);
                const detail = details[item.id];
                const showJudul = item.judul && item.judul !== slice[index - 1]?.judul;

                if (form?.mode === 'edit' && form.row.id === item.id) {
                  return (
                    <li key={item.id} id={anchor}>
                      <PasalForm
                        peraturanId={peraturanId}
                        peraturanLabel={peraturanLabel}
                        initialRow={form.row}
                        employee={employee}
                        onSaved={handleSaved}
                        onCancel={() => setForm(null)}
                      />
                    </li>
                  );
                }

                return (
                  <li key={item.id}>
                    {showJudul && (
                      <p className="text-xs font-medium text-madael-red tracking-[0.04em] uppercase mt-4 mb-2">{item.judul}</p>
                    )}
                    <div id={anchor} className="border border-[#E0E0E0] bg-white scroll-mt-24">
                      <button
                        type="button"
                        onClick={() => toggle(item.id)}
                        aria-expanded={isOpen}
                        className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm text-black hover:bg-[#FAFAFA] transition-colors"
                      >
                        {isOpen ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                        <span className="font-medium">{labelPasal(item)}</span>
                      </button>

                      {isOpen && (
                        <div className="px-4 pb-4 pt-1 border-t border-[#F0F0F0]">
                          {(!detail || detail.status === 'loading') && <LoadingState label="Memuat isi pasal..." />}
                          {detail?.status === 'error' && (
                            <ErrorState message="Isi pasal gagal dimuat." onRetry={() => fetchDetail(item.id, { force: true })} />
                          )}
                          {detail?.status === 'ok' && (
                            <>
                              {/* Teks biasa ter-escape oleh React; tidak ada HTML mentah. */}
                              <p className={`${ukuran.className} font-serif text-[#3D3D3D] leading-[1.75] max-w-[70ch] whitespace-pre-line break-words mt-3`}>
                                {detail.row.isi}
                              </p>
                              {detail.row.catatan && (
                                <div className="mt-4 bg-[#F4F4F4] px-3 py-2">
                                  <p className="text-[11px] font-medium text-[#6B6B6B] mb-0.5">Catatan internal</p>
                                  <p className="text-xs text-[#3D3D3D] whitespace-pre-line break-words">{detail.row.catatan}</p>
                                </div>
                              )}
                              <p className="text-[11px] text-[#9A9A9A] mt-3">
                                Diperbarui {formatTanggalWaktu(detail.row.updated_at)}
                                {detail.row.pengubah?.nama && ` oleh ${detail.row.pengubah.nama}`}
                              </p>
                              <div className="flex flex-wrap gap-3 mt-3">
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => startEdit(item)}
                                    className="inline-flex items-center gap-2 border border-[#E0E0E0] px-3 py-1.5 text-xs text-black hover:border-madael-red hover:text-madael-red transition-colors"
                                  >
                                    <Pencil size={12} />
                                    Ubah
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => toggleRiwayat(item.id)}
                                  aria-expanded={riwayat.has(item.id)}
                                  className="inline-flex items-center gap-2 border border-[#E0E0E0] px-3 py-1.5 text-xs text-black hover:border-madael-red hover:text-madael-red transition-colors"
                                >
                                  <History size={12} />
                                  Riwayat
                                </button>
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => { setActionError(''); setDeleteTarget(item); }}
                                    className="inline-flex items-center gap-2 border border-[#E0E0E0] px-3 py-1.5 text-xs text-red-700 hover:border-red-300 hover:bg-red-50 transition-colors"
                                  >
                                    <Trash2 size={12} />
                                    Hapus
                                  </button>
                                )}
                              </div>
                              {riwayat.has(item.id) && (
                                <PasalRiwayat
                                  pasalId={item.id}
                                  peraturanId={peraturanId}
                                  peraturanLabel={peraturanLabel}
                                  row={detail.row}
                                  canEdit={canEdit}
                                  onRestored={handleRestored}
                                />
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!matchIds && shown.length > visible && (
            <button
              type="button"
              onClick={() => setVisible((v) => v + PASAL_PAGE_SIZE)}
              className="mt-3 text-sm text-madael-red hover:text-madael-dark"
            >
              Tampilkan {Math.min(PASAL_PAGE_SIZE, shown.length - visible)} pasal berikutnya ({shown.length - visible} tersisa)
            </button>
          )}
        </>
      )}

      <PasalTerhapus
        peraturanId={peraturanId}
        peraturanLabel={peraturanLabel}
        canEdit={canEdit}
        refreshToken={terhapusToken}
        onRestored={load}
      />

      <p className="text-[11px] text-[#9A9A9A] mt-4">
        Teks pasal adalah salinan internal yang diinput manual. Rujuk teks resmi di sumbernya sebelum dipakai sebagai dasar hukum.
      </p>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus Pasal"
        message={<>Hapus <strong>{deleteTarget ? labelPasal(deleteTarget) : ''}</strong>? Isinya dicadangkan di Log Aktivitas dan bisa dipulihkan dari bagian Pasal Terhapus.</>}
        confirmLabel="Hapus"
        busyLabel="Menghapus..."
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
