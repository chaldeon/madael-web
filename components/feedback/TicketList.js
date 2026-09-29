'use client';

import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { FEEDBACK_JENIS_LABEL } from '@/lib/feedbackConfig';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import { api, formatWaktu, StatusBadge } from './parts';

export default function TicketList({ onOpen }) {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('aktif'); // 'aktif' | 'riwayat'

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

  // Tiket 'selesai' tidak dihapus — cuma pindah ke Riwayat.
  const aktif = tickets.filter((t) => t.status !== 'selesai');
  const riwayat = tickets.filter((t) => t.status === 'selesai');
  const visible = tab === 'aktif' ? aktif : riwayat;

  return (
    <div>
      <div className="flex items-center border-b border-[#E0E0E0] px-4">
        {[['aktif', `Aktif (${aktif.length})`], ['riwayat', `Riwayat (${riwayat.length})`]].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2.5 text-xs font-medium border-b-2 -mb-px ${
              tab === key ? 'border-madael-red text-black' : 'border-transparent text-[#6B6B6B] hover:text-black'
            }`}
          >
            {label}
          </button>
        ))}
        <button onClick={load} aria-label="Muat ulang" className="ml-auto text-[#6B6B6B] hover:text-madael-red">
          <RotateCcw size={14} />
        </button>
      </div>

      {visible.length === 0 ? (
        <EmptyState message={tab === 'aktif' ? 'Belum ada tiket aktif.' : 'Belum ada tiket yang selesai.'} />
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
                <p className="text-[11px] text-[#9A9A9A] mt-1 flex items-center gap-1.5">
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
