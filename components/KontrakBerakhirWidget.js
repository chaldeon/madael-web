'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import KontrakBadge from '@/components/KontrakBadge';
import { formatTanggalKepegawaian } from '@/lib/kepegawaian';

// Widget dashboard HRIS: kontrak PKWT/Magang yang segera atau sudah berakhir.
// Data dari /api/dashboard/kontrak-berakhir (modul employee_list / payroll).
// Tidak ikut-ikutan menghalangi dashboard: kalau gagal, error tampil di dalam
// kartunya saja dengan tombol coba lagi.
export default function KontrakBerakhirWidget() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  // Dinaikkan oleh tombol "Coba Lagi" untuk memicu muat ulang.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/kontrak-berakhir', { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Gagal memuat kontrak berakhir.');
        if (!cancelled) setState({ status: 'ready', data: body, error: null });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', data: null, error: err.message || 'Gagal memuat kontrak berakhir.' });
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const retry = () => {
    setState({ status: 'loading', data: null, error: null });
    setReloadKey((k) => k + 1);
  };

  const { status, data, error } = state;

  return (
    <div className="bg-white border border-[#E0E0E0] mb-8">
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[#E0E0E0]">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarClock size={18} className="text-madael-red shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-black">Kontrak Berakhir</p>
            <p className="text-xs text-[#6B6B6B]">
              {status === 'ready'
                ? `PKWT/Magang yang berakhir ≤ ${data.thresholdDays} hari atau sudah lewat.`
                : 'PKWT/Magang yang segera atau sudah berakhir.'}
            </p>
          </div>
        </div>
        {status === 'ready' && data.total > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            {data.berakhir > 0 && (
              <Link href="/employee/list?kontrak=berakhir" className="text-xs font-medium px-2.5 py-1 bg-red-50 text-red-700 hover:underline">
                {data.berakhir} sudah berakhir
              </Link>
            )}
            {data.segera > 0 && (
              <Link href="/employee/list?kontrak=segera" className="text-xs font-medium px-2.5 py-1 bg-amber-50 text-amber-800 hover:underline">
                {data.segera} segera
              </Link>
            )}
          </div>
        )}
      </div>

      {status === 'loading' && <LoadingState label="Memuat kontrak..." />}
      {status === 'error' && <ErrorState message={error} onRetry={retry} />}
      {status === 'ready' && data.total === 0 && (
        <EmptyState message={`Tidak ada kontrak yang berakhir dalam ${data.thresholdDays} hari ke depan.`} />
      )}
      {status === 'ready' && data.total > 0 && (
        <>
          <ul className="divide-y divide-[#F0F0F0]">
            {data.items.map((item) => (
              <li key={item.id}>
                <Link href={item.href} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-[#FAFAFA]">
                  <div className="min-w-0">
                    <p className="text-sm text-black truncate">{item.nama}</p>
                    <p className="text-xs text-[#6B6B6B] truncate">
                      {[item.jenis, item.posisi, item.perusahaan].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-xs text-[#6B6B6B]">{formatTanggalKepegawaian(item.kontrak_berakhir)}</span>
                    <KontrakBadge kontrakBerakhir={item.kontrak_berakhir} today={data.today} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {data.total > data.items.length && (
            <p className="px-5 py-3 text-xs text-[#6B6B6B] border-t border-[#F0F0F0]">
              Menampilkan {data.items.length} dari {data.total}.{' '}
              <Link href="/employee/list?kontrak=segera" className="text-madael-red hover:underline">Lihat di Employee List</Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}
