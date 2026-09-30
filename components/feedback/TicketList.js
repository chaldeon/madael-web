'use client';

import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { FEEDBACK_JENIS_LABEL } from '@/lib/feedbackConfig';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import { api, formatWaktu, ReplyMarker, StatusBadge } from './parts';

export default function TicketList({ onOpen }) {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('semua'); // 'semua' | 'baru' | 'diproses' | 'selesai'

  const load = useCallback(async () => {
    setError('');
    setTickets(null);
    const res = await api('/api/feedback/tickets');
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setTickets(res.data.tickets);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="p-4"><ErrorState message={error} onRetry={load} /></div>;
  if (!tickets) return <LoadingState label="Memuat tiket..." />;

  // Satu daftar; tiket 'selesai' tidak dihapus, cukup difilter.
  const countOf = (status) => tickets.filter((t) => t.status === status).length;
  const filters = [
    ['semua', `Semua (${tickets.length})`],
    ['baru', `Baru (${countOf('baru')})`],
    ['diproses', `Diproses (${countOf('diproses')})`],
    ['selesai', `Selesai (${countOf('selesai')})`],
  ];
  const visible = filter === 'semua' ? tickets : tickets.filter((t) => t.status === filter);
  const emptyMessages = {
    semua: 'Belum ada tiket.',
    selesai: 'Belum ada tiket yang selesai.',
  };

  return (
    <div>
      <div className="flex items-start gap-2 border-b border-[#E0E0E0] px-4 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {filters.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-2.5 py-1 text-xs border transition-colors ${
                filter === key
                  ? 'bg-madael-red text-white border-madael-red'
                  : 'bg-white text-[#3D3D3D] border-[#E0E0E0] hover:border-madael-red'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={load} aria-label="Muat ulang" className="ml-auto mt-1 shrink-0 text-[#6B6B6B] hover:text-madael-red">
          <RotateCcw size={14} />
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState message={emptyMessages[filter] || 'Tidak ada tiket pada filter ini.'} />
      ) : (
        <ul>
          {visible.map((t) => (
            <li key={t.id} className="border-b border-[#F0F0F0] last:border-0">
              <button onClick={() => onOpen(t.id)} className="w-full text-left px-4 py-3 hover:bg-[#FAFAFA]">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] text-[#6B6B6B]">
                    #{t.ticket_no} · {FEEDBACK_JENIS_LABEL[t.jenis] || t.jenis} · {t.modul_label}
                  </span>
                  <StatusBadge status={t.status} />
                </div>
                <p className={`text-sm text-black line-clamp-2 ${t.user_unread ? 'font-medium' : ''}`}>{t.ringkasan}</p>
                <p className="text-[11px] text-[#9A9A9A] mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <ReplyMarker ticket={t} viewer="user" />
                  {t.user_unread && (
                    <span className="inline-block w-2 h-2 rounded-full bg-madael-red shrink-0" aria-label="Balasan baru" />
                  )}
                  <span>
                    {t.last_staff_nama ? `Dijawab oleh: ${t.last_staff_nama} · ` : ''}
                    {formatWaktu(t.updated_at)}
                  </span>
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
