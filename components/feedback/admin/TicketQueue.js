'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { FEEDBACK_JENIS_LABEL } from '@/lib/feedbackConfig';
import EmptyState from '@/components/EmptyState';
import { formatWaktu, StatusBadge } from '../parts';

// Daftar tiket (presentasional). Data & filter dikelola halaman induk.
export default function TicketQueue({ tickets, total, page, pageSize, selectedId, onSelect, onPage, emptyMessage }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (tickets.length === 0) {
    return (
      <div className="bg-white border border-[#E0E0E0]">
        <EmptyState message={emptyMessage} />
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#E0E0E0]">
      <ul>
        {tickets.map((t) => (
          <li key={t.id} className="border-b border-[#F0F0F0] last:border-0">
            <button
              onClick={() => onSelect(t.id)}
              className={`w-full text-left px-4 py-3 border-l-4 hover:bg-[#FAFAFA] ${
                selectedId === t.id ? 'border-madael-red bg-[#FAFAFA]' : 'border-transparent'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] text-[#6B6B6B]">
                  #{t.ticket_no} · {FEEDBACK_JENIS_LABEL[t.jenis] || t.jenis} · {t.modul_label}
                </span>
                <StatusBadge status={t.status} />
              </div>
              <p className="text-sm font-medium text-black">{t.employee_nama}</p>
              <p className="text-sm text-[#3D3D3D] line-clamp-2">{t.ringkasan}</p>
              <p className="text-[11px] text-[#9A9A9A] mt-1">
                {t.last_staff_nama ? `Dijawab oleh: ${t.last_staff_nama}` : 'Belum dijawab'} · {formatWaktu(t.updated_at)}
                {t.status === 'selesai' && t.closed_by_nama && ` · Ditutup oleh ${t.closed_by_owner ? 'pengguna' : t.closed_by_nama}`}
              </p>
            </button>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#E0E0E0] text-xs text-[#6B6B6B]">
          <button
            onClick={() => onPage(page - 1)}
            disabled={page <= 1}
            aria-label="Halaman sebelumnya"
            className="disabled:opacity-30 hover:text-black"
          >
            <ChevronLeft size={16} />
          </button>
          <span>Halaman {page} dari {totalPages}</span>
          <button
            onClick={() => onPage(page + 1)}
            disabled={page >= totalPages}
            aria-label="Halaman berikutnya"
            className="disabled:opacity-30 hover:text-black"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
