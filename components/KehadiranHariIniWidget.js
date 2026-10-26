'use client';

import { useCallback, useEffect, useState } from 'react';
import { UserCheck, RotateCcw } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import { KEHADIRAN_KINDS, KEHADIRAN_LABEL } from '@/lib/kehadiranHariIni';

// Widget dashboard HRIS: kehadiran hari ini (belum clock-in, telat, cuti, hadir).
// Data dari /api/dashboard/kehadiran-hari-ini (modul KEHADIRAN_MODULES).
// Tidak ikut menghalangi dashboard: kalau gagal, error tampil di dalam
// kartunya saja dengan tombol coba lagi.
const KIND_STYLE = {
  belum_clock_in: 'bg-red-50 text-red-700',
  telat: 'bg-amber-50 text-amber-800',
  cuti: 'bg-blue-50 text-blue-700',
  menunggu: 'bg-[#F4F4F4] text-[#6B6B6B]',
  hadir: 'bg-green-50 text-green-700',
};

// Kartu ringkasan yang sekaligus jadi filter daftar.
const SUMMARY_KINDS = ['belum_clock_in', 'telat', 'cuti', 'hadir'];

function formatTanggalHari(hari, tanggal) {
  const label = new Date(`${tanggal}T00:00:00`).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  return `${hari}, ${label}`;
}

export default function KehadiranHariIniWidget() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [filter, setFilter] = useState('belum_clock_in');

  const load = useCallback(async (isCancelled = () => false) => {
    try {
      const res = await fetch('/api/dashboard/kehadiran-hari-ini', { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Gagal memuat kehadiran hari ini.');
      if (!isCancelled()) setState({ status: 'ready', data: body, error: null });
    } catch (err) {
      if (!isCancelled()) {
        setState({ status: 'error', data: null, error: err.message || 'Gagal memuat kehadiran hari ini.' });
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  // Saat muat ulang dari state 'ready', data lama tetap tampil sampai data baru tiba.
  const reload = () => {
    if (state.status !== 'ready') setState({ status: 'loading', data: null, error: null });
    load();
  };

  const { status, data, error } = state;
  const items = status === 'ready'
    ? data.items.filter((i) => filter === 'semua' || i.kind === filter)
    : [];

  return (
    <div className="bg-white border border-[#E0E0E0] mb-8">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#E0E0E0]">
        <div className="flex items-center gap-2 min-w-0">
          <UserCheck size={18} className="text-madael-red shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-black">Kehadiran Hari Ini</p>
            <p className="text-xs text-[#6B6B6B] truncate">
              {status === 'ready'
                ? `${formatTanggalHari(data.hari, data.today)} · per ${data.jam} WIB`
                : 'Siapa yang belum clock-in, telat, atau cuti hari ini.'}
            </p>
          </div>
        </div>
        {status === 'ready' && (
          <button
            onClick={reload}
            aria-label="Muat ulang kehadiran hari ini"
            className="shrink-0 p-1.5 text-[#6B6B6B] hover:text-black"
          >
            <RotateCcw size={14} />
          </button>
        )}
      </div>

      {status === 'loading' && <LoadingState label="Memuat kehadiran..." />}
      {status === 'error' && <ErrorState message={error} onRetry={reload} />}

      {status === 'ready' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[#E0E0E0] border-b border-[#E0E0E0]">
            {SUMMARY_KINDS.map((kind) => (
              <button
                key={kind}
                onClick={() => setFilter(kind)}
                className={`px-4 py-3 text-left bg-white hover:bg-[#FAFAFA] ${
                  filter === kind ? 'border-b-2 border-madael-red' : ''
                }`}
              >
                <p className="text-xl font-semibold text-black">{data.counts[kind]}</p>
                <p className="text-xs text-[#6B6B6B]">{KEHADIRAN_LABEL[kind]}</p>
              </button>
            ))}
          </div>

          {data.wajibMasuk === 0 && data.counts.cuti === 0 ? (
            <EmptyState message="Tidak ada karyawan yang dijadwalkan masuk hari ini." />
          ) : items.length === 0 ? (
            <EmptyState message={`Tidak ada karyawan dengan status "${KEHADIRAN_LABEL[filter] || 'Semua'}" hari ini.`} />
          ) : (
            <ul className="divide-y divide-[#F0F0F0] max-h-96 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-black truncate">{item.nama}</p>
                    <p className="text-xs text-[#6B6B6B] truncate">
                      {[item.posisi, item.perusahaan].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {(item.kind === 'hadir' || item.kind === 'telat') && (
                      <span className="text-xs text-[#6B6B6B]">Clock-in {item.clock_in}</span>
                    )}
                    {item.jenis_cuti && <span className="text-xs text-[#6B6B6B]">{item.jenis_cuti}</span>}
                    <span className={`text-xs font-medium px-2.5 py-1 ${KIND_STYLE[item.kind]}`}>
                      {KEHADIRAN_LABEL[item.kind]}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-t border-[#F0F0F0] text-xs text-[#6B6B6B]">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {data.counts.menunggu > 0 && (
                <button onClick={() => setFilter('menunggu')} className="hover:underline">
                  {data.counts.menunggu} belum waktunya
                </button>
              )}
              {data.counts.tanpa_jadwal > 0 && (
                <span>{data.counts.tanpa_jadwal} belum punya jadwal kerja</span>
              )}
              {data.counts.libur > 0 && <span>{data.counts.libur} libur hari ini</span>}
            </div>
            <button onClick={() => setFilter('semua')} className="text-madael-red hover:underline">
              Lihat semua ({KEHADIRAN_KINDS.reduce((n, k) => n + (data.counts[k] || 0), 0)})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
