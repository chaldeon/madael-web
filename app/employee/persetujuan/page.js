'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ClipboardCheck, RefreshCw } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

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

      <div className="bg-white border border-[#E0E0E0]">
        {visible.length === 0 ? (
          <EmptyState message={emptyMessage} icon={ClipboardCheck} />
        ) : (
          visible.map((item) => (
            // Baris compact (± 44px di desktop). Di mobile ringkasan turun ke
            // baris kedua. Slot kiri (pilih) dan slot kanan (aksi) disiapkan
            // untuk item #4 (approve/tolak langsung + bulk): #4 cukup mengisi
            // keduanya tanpa mengubah tata letak lagi.
            <div
              key={item.id}
              className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:min-h-[44px] border-b border-[#F4F4F4] last:border-0"
            >
              <div className="shrink-0 empty:hidden">{/* slot kiri: checkbox pilih (#4) */}</div>
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
                {/* slot kanan: tombol aksi Setujui/Tolak (#4) ditambahkan sebelum Tinjau */}
                <Link
                  href={item.href}
                  className="bg-madael-red text-white px-3 py-1.5 text-xs font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors no-underline"
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
    </div>
  );
}
