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
import TicketDeepLink from '@/components/feedback/TicketDeepLink';

const selectClass =
  'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

export default function SupportPage() {
  const [statusFilter, setStatusFilter] = useState('semua'); // 'semua' | 'perlu_dibalas' | 'baru' | 'diproses' | 'selesai'
  const [modul, setModul] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);

  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const req = ++reqRef.current;
    setLoading(true);
    setError('');
    const qs = new URLSearchParams({ status: statusFilter, modul, page: String(page) });
    const res = await api(`/api/feedback/admin/tickets?${qs}`);
    if (req !== reqRef.current) return; // respons basi (filter sudah berubah lagi)
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Halaman terakhir jadi kosong (mis. setelah status tiket berubah): balik ke halaman 1.
    if (res.data.tickets.length === 0 && page > 1) {
      setPage(1);
      return;
    }
    setData(res.data);
  }, [statusFilter, modul, page]);

  useEffect(() => {
    load();
  }, [load]);

  const changeStatus = (next) => { setStatusFilter(next); setPage(1); };
  const changeModul = (next) => { setModul(next); setPage(1); };

  const counts = data?.counts || { baru: 0, diproses: 0, selesai: 0, perlu_dibalas: 0 };
  const filters = [
    ['semua', `Semua (${counts.baru + counts.diproses + counts.selesai})`],
    ['perlu_dibalas', `Perlu dibalas (${counts.perlu_dibalas})`],
    ['baru', `Baru (${counts.baru})`],
    ['diproses', `Diproses (${counts.diproses})`],
    ['selesai', `Selesai (${counts.selesai})`],
  ];
  const emptyMessages = {
    semua: 'Belum ada tiket.',
    perlu_dibalas: 'Tidak ada tiket yang menunggu balasan.',
    selesai: 'Belum ada tiket yang selesai.',
  };

  return (
    <div className="max-w-[1200px] mx-auto px-6 md:px-10 py-10">
      {/* Klik notifikasi "tiket baru / pesan baru" -> ?kelola=<id> membuka tiketnya */}
      <TicketDeepLink param="kelola" onOpen={setSelectedId} />

      <div className="flex items-center gap-2 mb-1">
        <LifeBuoy size={18} className="text-madael-red" />
        <h1 className="text-2xl font-semibold text-black">Pusat Bantuan</h1>
      </div>
      <p className="text-sm text-[#6B6B6B] mb-6">
        Tiket feedback dari pengguna. Tiket yang selesai tidak dihapus; pilih filter Selesai untuk melihat riwayatnya.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex max-w-full overflow-x-auto border border-[#E0E0E0] bg-white">
          {filters.map(([key, label]) => (
            <button
              key={key}
              onClick={() => changeStatus(key)}
              className={`shrink-0 px-4 py-2 text-sm whitespace-nowrap ${
                statusFilter === key ? 'bg-madael-red text-white' : 'text-[#3D3D3D] hover:bg-[#F4F4F4]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

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
              emptyMessage={emptyMessages[statusFilter] || 'Tidak ada tiket pada filter ini.'}
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
