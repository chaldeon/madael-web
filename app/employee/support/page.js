'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { FEEDBACK_MODULES } from '@/lib/feedbackConfig';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import { api } from '@/components/feedback/parts';
import TicketQueue from '@/components/feedback/admin/TicketQueue';
import TicketDetail from '@/components/feedback/admin/TicketDetail';

const selectClass =
  'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

export default function SupportPage() {
  const [tab, setTab] = useState('aktif'); // 'aktif' | 'riwayat'
  const [statusFilter, setStatusFilter] = useState('semua'); // 'semua' | 'baru' | 'diproses' (tab aktif)
  const [modul, setModul] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reqRef = useRef(0);

  const apiStatus = tab === 'riwayat' ? 'selesai' : statusFilter === 'semua' ? 'aktif' : statusFilter;

  const load = useCallback(async () => {
    const req = ++reqRef.current;
    setLoading(true);
    setError('');
    const qs = new URLSearchParams({ status: apiStatus, modul, page: String(page) });
    const res = await api(`/api/feedback/admin/tickets?${qs}`);
    if (req !== reqRef.current) return; // respons basi (filter sudah berubah lagi)
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Halaman terakhir jadi kosong (mis. setelah tiket dipindah ke Riwayat): balik ke halaman 1.
    if (res.data.tickets.length === 0 && page > 1) {
      setPage(1);
      return;
    }
    setData(res.data);
  }, [apiStatus, modul, page]);

  useEffect(() => {
    load();
  }, [load]);

  const changeTab = (next) => { setTab(next); setPage(1); };
  const changeStatus = (next) => { setStatusFilter(next); setPage(1); };
  const changeModul = (next) => { setModul(next); setPage(1); };

  const counts = data?.counts || { baru: 0, diproses: 0, selesai: 0 };
  const tabs = [
    ['aktif', `Aktif (${counts.baru + counts.diproses})`],
    ['riwayat', `Riwayat (${counts.selesai})`],
  ];
  const chips = [
    ['semua', 'Semua'],
    ['baru', `Baru (${counts.baru})`],
    ['diproses', `Diproses (${counts.diproses})`],
  ];

  return (
    <div className="max-w-[1200px] mx-auto px-6 md:px-10 py-10">
      <div className="flex items-center gap-2 mb-1">
        <LifeBuoy size={18} className="text-madael-red" />
        <h1 className="text-2xl font-semibold text-black">Pusat Bantuan</h1>
      </div>
      <p className="text-sm text-[#6B6B6B] mb-6">
        Tiket feedback dari pengguna. Tiket yang selesai dipindah ke Riwayat, tidak dihapus.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex border border-[#E0E0E0] bg-white">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => changeTab(key)}
              className={`px-4 py-2 text-sm ${tab === key ? 'bg-madael-red text-white' : 'text-[#3D3D3D] hover:bg-[#F4F4F4]'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'aktif' && (
          <div className="flex gap-2">
            {chips.map(([key, label]) => (
              <button
                key={key}
                onClick={() => changeStatus(key)}
                className={`px-3 py-1.5 text-xs border transition-colors ${
                  statusFilter === key
                    ? 'border-madael-red text-madael-red bg-white'
                    : 'border-[#E0E0E0] text-[#6B6B6B] bg-white hover:border-madael-red'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <select value={modul} onChange={(e) => changeModul(e.target.value)} className={`${selectClass} ml-auto`}>
          <option value="all">Semua Modul</option>
          {FEEDBACK_MODULES.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data ? (
        <LoadingState label="Memuat tiket..." />
      ) : (
        <div className="grid lg:grid-cols-[400px_1fr] gap-6 items-start">
          <div className={`${selectedId ? 'hidden lg:block' : ''} ${loading ? 'opacity-60' : ''}`}>
            <TicketQueue
              tickets={data.tickets}
              total={data.total}
              page={page}
              pageSize={data.pageSize}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onPage={setPage}
              emptyMessage={tab === 'aktif' ? 'Tidak ada tiket aktif.' : 'Belum ada tiket yang selesai.'}
            />
          </div>

          <div className={selectedId ? '' : 'hidden lg:block'}>
            {selectedId ? (
              <TicketDetail key={selectedId} id={selectedId} onBack={() => setSelectedId(null)} onChanged={load} />
            ) : (
              <div className="bg-white border border-[#E0E0E0]">
                <EmptyState message="Pilih tiket untuk melihat percakapan dan membalas." icon={LifeBuoy} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
