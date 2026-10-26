'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ClipboardCheck, RefreshCw, X } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import ConfirmDialog from '@/components/ConfirmDialog';
import Toast from '@/components/employee-list/Toast';
import {
  bisaKeputusanLangsung, kirimKeputusan, batasAlasan, alasanWajibUntuk, DIRECT_ACTIONS,
} from '@/lib/approvalActions';

// Jumlah baris yang ditampilkan per "halaman" — seluruh antrean dimuat sekali
// dari server, lalu ditampilkan bertahap lewat tombol "Tampilkan lebih banyak".
const PAGE_SIZE = 30;

const MS_PER_HARI = 24 * 60 * 60 * 1000;

function formatWaktu(value) {
  return new Date(value).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// "hari ini" / "kemarin" / "N hari lalu" — lama pengajuan menunggu.
function lamaMenunggu(value) {
  const hari = Math.floor((Date.now() - new Date(value).getTime()) / MS_PER_HARI);
  if (hari <= 0) return 'hari ini';
  if (hari === 1) return 'kemarin';
  return `${hari} hari lalu`;
}

export default function PersetujuanPage() {
  const [groups, setGroups] = useState([]);
  const [items, setItems] = useState([]);
  const [failed, setFailed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [jenisFilter, setJenisFilter] = useState('all'); // 'all' | module key
  const [urutan, setUrutan] = useState('terlama'); // 'terlama' | 'terbaru'
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Keputusan langsung (#4): pilihan massal, dialog konfirmasi, hasil terakhir.
  const [selected, setSelected] = useState(() => new Set()); // id item (`${module}:${id}`)
  const [confirm, setConfirm] = useState(null); // { mode: 'approve' | 'reject', targets: [item] }
  const [alasan, setAlasan] = useState('');
  const [alasanError, setAlasanError] = useState('');
  const [processing, setProcessing] = useState(false);
  const [hasil, setHasil] = useState(null); // { gagal: [{ item, error }], catatan: [string] }
  const [toast, setToast] = useState(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const loadInbox = useCallback(async () => {
    try {
      const res = await fetch('/api/approvals/inbox', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(json.error || 'Gagal memuat antrean persetujuan.');
        return;
      }
      setGroups(json.groups || []);
      setItems(json.items || []);
      setFailed(json.failed || []);
      setLoadError(null);
    } catch {
      setLoadError('Gagal memuat antrean persetujuan. Periksa koneksi internet kamu.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    (async () => { await loadInbox(); })();
  }, [loadInbox]);

  // Muat ulang saat tab kembali aktif (jeda 30 detik) supaya antrean tidak basi
  // kalau halaman dibiarkan terbuka — pola yang sama dengan badge dashboard.
  useEffect(() => {
    let lastFetch = Date.now();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch > 30_000) {
        lastFetch = Date.now();
        loadInbox();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadInbox]);

  const refresh = () => {
    setRefreshing(true);
    loadInbox();
  };

  const totalPending = useMemo(() => groups.reduce((sum, g) => sum + g.total, 0), [groups]);
  const terpotong = useMemo(() => groups.filter((g) => g.total > g.shown), [groups]);

  const filtered = useMemo(() => {
    const rows = jenisFilter === 'all' ? items : items.filter((i) => i.module === jenisFilter);
    const arah = urutan === 'terlama' ? 1 : -1;
    return [...rows].sort(
      (a, b) => arah * (new Date(a.diajukan).getTime() - new Date(b.diajukan).getTime())
    );
  }, [items, jenisFilter, urutan]);

  const visible = filtered.slice(0, visibleCount);

  const changeJenis = (value) => {
    setJenisFilter(value);
    setVisibleCount(PAGE_SIZE);
    // Pilihan dikosongkan saat filter berubah supaya aksi massal tidak
    // mengenai baris yang sedang tidak terlihat.
    setSelected(new Set());
  };

  // Baris yang bisa diproses langsung dan sedang tampil.
  const bisaDiproses = useMemo(() => visible.filter(bisaKeputusanLangsung), [visible]);
  const itemTerpilih = useMemo(
    () => items.filter((i) => selected.has(i.id) && bisaKeputusanLangsung(i)),
    [items, selected]
  );
  const semuaTerpilih =
    bisaDiproses.length > 0 && bisaDiproses.every((i) => selected.has(i.id));

  const toggleSatu = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSemua = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (semuaTerpilih) bisaDiproses.forEach((i) => next.delete(i.id));
      else bisaDiproses.forEach((i) => next.add(i.id));
      return next;
    });

  const bukaKonfirmasi = (mode, targets) => {
    if (processing || targets.length === 0) return;
    setAlasan('');
    setAlasanError('');
    setConfirm({ mode, targets });
  };

  const tutupKonfirmasi = () => {
    if (processing) return;
    setConfirm(null);
    setAlasan('');
    setAlasanError('');
  };

  // Jalankan keputusan SATU PER SATU (berurutan): route cuti mengubah kuota
  // lewat compare-and-swap, jadi permintaan paralel untuk karyawan yang sama
  // bisa saling bentrok. Satu yang gagal tidak menghentikan sisanya.
  const jalankanKeputusan = async () => {
    if (!confirm || processing) return;
    const { mode, targets } = confirm;
    const teks = alasan.trim();

    if (mode === 'reject' && alasanWajibUntuk(targets) && !teks) {
      setAlasanError(
        targets.length > 1
          ? 'Alasan penolakan wajib diisi (ada pengajuan lembur di antara yang dipilih).'
          : 'Alasan penolakan wajib diisi.'
      );
      return;
    }

    setProcessing(true);
    const berhasil = [];
    const gagal = [];
    const catatan = [];
    for (const item of targets) {
      const r = await kirimKeputusan(item, mode, mode === 'reject' ? teks : null);
      if (r.ok) {
        berhasil.push(item);
        if (r.warning) catatan.push(`${item.pemohon}: ${r.warning}`);
      } else {
        gagal.push({ item, error: r.error });
      }
    }

    // Yang berhasil langsung hilang dari daftar; sisanya disinkronkan ulang
    // dari server (yang gagal karena 'sudah diproses' ikut hilang di sana).
    const idBerhasil = new Set(berhasil.map((i) => i.id));
    setItems((prev) => prev.filter((i) => !idBerhasil.has(i.id)));
    setGroups((prev) =>
      prev.map((g) => {
        const n = berhasil.filter((i) => i.module === g.key).length;
        return n > 0 ? { ...g, total: Math.max(0, g.total - n), shown: Math.max(0, g.shown - n) } : g;
      })
    );
    setSelected((prev) => {
      const next = new Set(prev);
      idBerhasil.forEach((id) => next.delete(id));
      return next;
    });

    setHasil(gagal.length > 0 || catatan.length > 0 ? { gagal, catatan } : null);
    const kata = mode === 'approve' ? 'disetujui' : 'ditolak';
    if (berhasil.length > 0) {
      setToast({
        type: gagal.length > 0 ? 'error' : 'success',
        message:
          gagal.length > 0
            ? `${berhasil.length} pengajuan ${kata}, ${gagal.length} gagal (lihat rincian di atas daftar).`
            : `${berhasil.length} pengajuan ${kata}.`,
      });
    } else if (gagal.length > 0) {
      setToast({ type: 'error', message: `Tidak ada pengajuan yang ${kata}. Lihat rincian di atas daftar.` });
    }

    setProcessing(false);
    setConfirm(null);
    setAlasan('');
    setAlasanError('');
    loadInbox();
  };

  if (loading) {
    return (
      <div className="max-w-[860px] mx-auto px-6 py-10">
        <LoadingState label="Memuat antrean persetujuan..." />
      </div>
    );
  }

  if (loadError) {
    const retry = () => {
      setLoading(true);
      setLoadError(null);
      loadInbox();
    };
    return (
      <div className="max-w-[860px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={retry} />
      </div>
    );
  }

  const filterButtonClass = (active) =>
    `px-3 py-1 text-[11px] font-medium tracking-[0.02em] border transition-colors cursor-pointer ${
      active
        ? 'bg-madael-red text-white border-madael-red'
        : 'bg-white text-[#6B6B6B] border-[#E0E0E0] hover:text-black'
    }`;

  const selectClass =
    'border border-[#E0E0E0] px-2 py-1 text-[11px] text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  const aksiSetujuiClass =
    'px-3 py-1.5 text-xs font-medium tracking-[0.04em] border border-[#166534] text-[#166534] hover:bg-[#166534] hover:text-white transition-colors cursor-pointer';
  const aksiTolakClass =
    'px-3 py-1.5 text-xs font-medium tracking-[0.04em] border border-[#E0E0E0] text-madael-red hover:border-madael-red transition-colors cursor-pointer';

  const emptyMessage =
    items.length === 0
      ? 'Tidak ada pengajuan yang menunggu keputusanmu.'
      : 'Tidak ada pengajuan yang cocok dengan filter ini.';

  return (
    <div className="max-w-[860px] mx-auto px-6 py-6">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <h1 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] min-w-0">
          Inbox Persetujuan
          {totalPending > 0 && (
            <span className="font-sans text-xs text-[#6B6B6B] tracking-normal ml-2">
              {totalPending} menunggu
            </span>
          )}
        </h1>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-madael-red hover:text-madael-dark disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Memuat...' : 'Muat ulang'}
        </button>
      </div>

      {failed.length > 0 && (
        <p className="text-xs text-red-600 mb-3">
          Antrean {failed.join(', ')} gagal dimuat, jadi belum tampil di sini. Coba muat ulang atau buka halaman modulnya langsung.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <div className="flex flex-wrap">
          <button
            type="button"
            onClick={() => changeJenis('all')}
            className={filterButtonClass(jenisFilter === 'all')}
          >
            Semua{totalPending > 0 ? ` (${totalPending})` : ''}
          </button>
          {groups.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => changeJenis(g.key)}
              className={`${filterButtonClass(jenisFilter === g.key)} -ml-px`}
            >
              {g.jenis} ({g.total})
            </button>
          ))}
        </div>

        <select
          value={urutan}
          onChange={(e) => setUrutan(e.target.value)}
          className={selectClass}
          aria-label="Urutan"
        >
          <option value="terlama">Terlama menunggu dulu</option>
          <option value="terbaru">Terbaru dulu</option>
        </select>
      </div>

      {hasil && (
        <div className="mb-3 border border-[#E0E0E0] border-l-4 border-l-madael-red bg-white px-4 py-3" role="alert">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-medium text-black">
              {hasil.gagal.length > 0
                ? `${hasil.gagal.length} pengajuan tidak bisa diproses:`
                : 'Catatan dari server:'}
            </p>
            <button
              type="button"
              onClick={() => setHasil(null)}
              aria-label="Tutup rincian"
              className="shrink-0 text-[#9A9A9A] hover:text-black cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
          <ul className="mt-1.5 space-y-1 text-xs text-[#4A4A4A]">
            {hasil.gagal.map(({ item, error }) => (
              <li key={item.id}>
                <span className="font-medium text-black">{item.jenis} · {item.pemohon}</span> ({item.ringkasan}): {error}
              </li>
            ))}
            {hasil.catatan.map((c, i) => (
              <li key={`catatan-${i}`}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white border border-[#E0E0E0]">
        {bisaDiproses.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 min-h-[36px] border-b border-[#E0E0E0] bg-[#FAFAFA]">
            <label className="flex items-center gap-3 text-xs text-[#6B6B6B] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={semuaTerpilih}
                onChange={toggleSemua}
                disabled={processing}
                className="w-4 h-4 accent-madael-red cursor-pointer"
              />
              {itemTerpilih.length > 0
                ? `${itemTerpilih.length} dipilih`
                : `Pilih semua yang bisa diproses (${bisaDiproses.length})`}
            </label>
            {itemTerpilih.length > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => bukaKonfirmasi('approve', itemTerpilih)}
                  disabled={processing}
                  className={`${aksiSetujuiClass} disabled:opacity-50`}
                >
                  Setujui terpilih
                </button>
                <button
                  type="button"
                  onClick={() => bukaKonfirmasi('reject', itemTerpilih)}
                  disabled={processing}
                  className={`${aksiTolakClass} disabled:opacity-50`}
                >
                  Tolak terpilih
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  disabled={processing}
                  className="text-xs text-[#6B6B6B] hover:text-black cursor-pointer disabled:opacity-50"
                >
                  Batal pilih
                </button>
              </div>
            )}
          </div>
        )}
        {visible.length === 0 ? (
          <EmptyState message={emptyMessage} icon={ClipboardCheck} />
        ) : (
          visible.map((item) => (
            // Baris compact (± 44px di desktop). Di mobile ringkasan turun ke
            // baris kedua. Slot kiri = checkbox pilih (hanya jenis yang bisa
            // diproses langsung), slot kanan = tombol aksi.
            <div
              key={item.id}
              className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:min-h-[44px] border-b border-[#F4F4F4] last:border-0"
            >
              {/* Slot kiri: lebar tetap supaya kolom rapi walau tidak semua baris punya checkbox. */}
              <div className={bisaDiproses.length > 0 ? 'shrink-0 w-4' : 'shrink-0 empty:hidden'}>
                {bisaKeputusanLangsung(item) && (
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSatu(item.id)}
                    disabled={processing}
                    aria-label={`Pilih ${item.jenis} dari ${item.pemohon}`}
                    className="block w-4 h-4 accent-madael-red cursor-pointer"
                  />
                )}
              </div>
              <span className="shrink-0 text-[10px] font-medium tracking-[0.04em] px-1.5 py-0.5 bg-[#F4F4F4] text-[#6B6B6B] uppercase">
                {item.jenis}
              </span>
              <span
                className="min-w-0 flex-1 sm:flex-none sm:max-w-[180px] truncate text-[13px] font-medium text-black"
                title={item.pemohon}
              >
                {item.pemohon}
              </span>
              <span
                className="order-last basis-full sm:order-none sm:basis-0 min-w-0 sm:flex-1 text-[13px] text-[#4A4A4A] break-words line-clamp-2 sm:truncate"
                title={item.ringkasan}
              >
                {item.ringkasan}
              </span>
              <span
                className="shrink-0 text-xs text-[#9A9A9A] whitespace-nowrap"
                title={`Diajukan ${formatWaktu(item.diajukan)}`}
              >
                {lamaMenunggu(item.diajukan)}
              </span>
              <div className="shrink-0 flex items-center gap-2">
                {bisaKeputusanLangsung(item) && (
                  <>
                    <button
                      type="button"
                      onClick={() => bukaKonfirmasi('approve', [item])}
                      disabled={processing}
                      className={`${aksiSetujuiClass} disabled:opacity-50`}
                    >
                      Setujui
                    </button>
                    <button
                      type="button"
                      onClick={() => bukaKonfirmasi('reject', [item])}
                      disabled={processing}
                      className={`${aksiTolakClass} disabled:opacity-50`}
                    >
                      Tolak
                    </button>
                  </>
                )}
                {/* Jenis tanpa aksi langsung (Perubahan Profil, Koreksi Absensi):
                    Tinjau tetap tombol utama. Yang punya aksi langsung: Tinjau
                    jadi tautan biasa untuk melihat detail di halaman modul. */}
                <Link
                  href={item.href}
                  className={
                    bisaKeputusanLangsung(item)
                      ? 'px-1.5 py-1.5 text-xs text-[#6B6B6B] hover:text-black underline underline-offset-2'
                      : 'bg-madael-red text-white px-3 py-1.5 text-xs font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors no-underline'
                  }
                >
                  Tinjau
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      {filtered.length > visibleCount && (
        <div className="text-center mt-4">
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="px-5 py-2 text-xs font-medium text-madael-red border border-madael-red hover:bg-madael-red hover:text-white transition-colors cursor-pointer"
          >
            Tampilkan lebih banyak ({filtered.length - visibleCount} lagi)
          </button>
        </div>
      )}

      {terpotong.length > 0 && (
        <p className="text-xs text-[#9A9A9A] mt-4">
          {terpotong.map((g) => `${g.jenis}: ${g.shown} terlama dari ${g.total}`).join(' · ')}.
          Sisanya bisa dibuka di halaman modulnya.
        </p>
      )}

      <Toast toast={toast} onDismiss={dismissToast} />
      <ConfirmDialog
        open={!!confirm}
        title={confirm ? judulKonfirmasi(confirm) : ''}
        message={confirm ? pesanKonfirmasi(confirm, alasanError) : null}
        confirmLabel={confirm?.mode === 'approve' ? 'Setujui' : 'Tolak'}
        busy={processing}
        busyLabel="Memproses..."
        onConfirm={jalankanKeputusan}
        onCancel={tutupKonfirmasi}
        {...(confirm?.mode === 'reject'
          ? {
              inputLabel: alasanWajibUntuk(confirm.targets) ? 'Alasan penolakan (wajib)' : 'Alasan penolakan (opsional)',
              inputPlaceholder: 'Tulis alasan yang akan dibaca karyawan',
              inputMaxLength: batasAlasan(confirm.targets),
              value: alasan,
              onChange: (v) => { setAlasan(v); if (alasanError) setAlasanError(''); },
            }
          : {})}
      />
    </div>
  );
}

// Teks dialog konfirmasi. Untuk aksi massal, rincian jumlah per jenis ditampilkan.
function judulKonfirmasi({ mode, targets }) {
  const aksi = mode === 'approve' ? 'Setujui' : 'Tolak';
  return targets.length === 1 ? `${aksi} Pengajuan` : `${aksi} ${targets.length} Pengajuan`;
}

function pesanKonfirmasi({ mode, targets }, alasanError) {
  const kata = mode === 'approve' ? 'Setujui' : 'Tolak';
  let isi;
  if (targets.length === 1) {
    const t = targets[0];
    isi = (
      <>
        {kata} pengajuan <strong>{t.jenis}</strong> dari <strong>{t.pemohon}</strong> ({t.ringkasan})?
      </>
    );
  } else {
    const perJenis = {};
    targets.forEach((t) => { perJenis[t.jenis] = (perJenis[t.jenis] || 0) + 1; });
    const rincian = Object.entries(perJenis).map(([j, n]) => `${n} ${j}`).join(', ');
    isi = (
      <>
        {kata} <strong>{targets.length} pengajuan</strong> ({rincian}) satu per satu? Karyawan akan
        menerima notifikasi untuk setiap keputusan.
      </>
    );
  }

  const catatan = mode === 'approve'
    ? [...new Set(targets.map((t) => DIRECT_ACTIONS[t.module].catatanSetuju).filter(Boolean))].join(' ')
    : '';

  return (
    <>
      {isi}
      {catatan && <span className="text-[#6B6B6B]"> {catatan}</span>}
      {alasanError && <span className="block mt-2 text-xs text-red-600">{alasanError}</span>}
    </>
  );
}
