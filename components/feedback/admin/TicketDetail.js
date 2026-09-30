'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Paperclip, Send } from 'lucide-react';
import { FEEDBACK_JENIS_LABEL, FEEDBACK_MAX_TEXT } from '@/lib/feedbackConfig';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import { api, formatWaktu, inputClass, ReplyMarker, StatusBadge, AttachmentPicker } from '../parts';

// Aksi status yang tersedia per status saat ini. 'selesai' hanya memindahkan
// tiket (bisa difilter lewat 'Selesai') — data dan percakapan tetap utuh.
const STATUS_ACTIONS = {
  baru: [['diproses', 'Tandai Diproses'], ['selesai', 'Tandai Selesai']],
  diproses: [['selesai', 'Tandai Selesai']],
  selesai: [['diproses', 'Buka Kembali']],
};

export default function TicketDetail({ id, onBack, onChanged }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [isi, setIsi] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [changing, setChanging] = useState(false);
  const [actionError, setActionError] = useState('');
  const endRef = useRef(null);

  const load = useCallback(async () => {
    setLoadError('');
    const res = await api(`/api/feedback/admin/tickets/${id}`);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    setData(res.data);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (data) endRef.current?.scrollIntoView({ block: 'end' });
  }, [data]);

  const handleReply = async (e) => {
    e.preventDefault();
    if (sending) return;
    if (!isi.trim()) {
      setActionError('Balasan tidak boleh kosong.');
      return;
    }
    setSending(true);
    setActionError('');

    const body = new FormData();
    body.append('isi', isi.trim());
    if (file) body.append('file', file);

    const res = await api(`/api/feedback/admin/tickets/${id}/messages`, { method: 'POST', body });
    setSending(false);
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    setIsi('');
    setFile(null);
    await load();
    onChanged();
  };

  const handleStatus = async (status) => {
    if (changing) return;
    setChanging(true);
    setActionError('');
    const res = await api(`/api/feedback/admin/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    setChanging(false);
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    await load();
    onChanged();
  };

  if (loadError) return <div className="bg-white border border-[#E0E0E0] p-6"><ErrorState message={loadError} onRetry={load} /></div>;
  if (!data) return <div className="bg-white border border-[#E0E0E0]"><LoadingState label="Memuat tiket..." /></div>;

  const { ticket, messages, viewer_nama: viewerNama } = data;

  return (
    <div className="bg-white border border-[#E0E0E0] flex flex-col">
      <div className="px-5 py-4 border-b border-[#E0E0E0]">
        <button onClick={onBack} className="lg:hidden flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-black mb-3">
          <ArrowLeft size={16} />
          Kembali ke daftar
        </button>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-[#6B6B6B]">
              #{ticket.ticket_no} · {FEEDBACK_JENIS_LABEL[ticket.jenis] || ticket.jenis} · {ticket.modul_label}
            </p>
            <p className="text-base font-medium text-black mt-0.5">{ticket.employee_nama}</p>
            <p className="text-[11px] text-[#9A9A9A] mt-0.5 truncate">
              {ticket.halaman ? `Dari halaman ${ticket.halaman} · ` : ''}dibuat {formatWaktu(ticket.created_at)}
            </p>
            {ticket.status === 'selesai' && ticket.closed_by_nama && (
              <p className="text-[11px] text-[#6B6B6B] mt-0.5">
                Ditutup oleh {ticket.closed_by_owner ? `pengguna (${ticket.closed_by_nama})` : ticket.closed_by_nama}
                {ticket.closed_at ? ` · ${formatWaktu(ticket.closed_at)}` : ''}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <StatusBadge status={ticket.status} />
            <ReplyMarker ticket={ticket} viewer="admin" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {STATUS_ACTIONS[ticket.status].map(([status, label]) => (
            <button
              key={status}
              onClick={() => handleStatus(status)}
              disabled={changing}
              className="border border-[#E0E0E0] px-3 py-1.5 text-xs text-[#3D3D3D] hover:border-madael-red hover:text-madael-red transition-colors disabled:opacity-50"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-4 space-y-3 max-h-[52vh] overflow-y-auto">
        {messages.map((m) => (
          <div key={m.id} className={m.is_staff ? 'pl-10' : 'pr-10'}>
            <p className={`text-[11px] text-[#6B6B6B] mb-1 ${m.is_staff ? 'text-right' : ''}`}>
              {m.is_staff ? `Dijawab oleh: ${m.author_nama}` : m.author_nama} · {formatWaktu(m.created_at)}
            </p>
            <div className={`px-3 py-2 text-sm text-black whitespace-pre-wrap break-words border ${
              m.is_staff ? 'bg-[#F4F4F4] border-[#E0E0E0]' : 'bg-white border-madael-red/40'
            }`}>
              {m.isi}
              {m.attachment_url && (
                <a
                  href={m.attachment_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-1.5 text-xs text-madael-red hover:underline"
                >
                  <Paperclip size={12} />
                  <span className="truncate">{m.attachment_name || 'Lihat lampiran'}</span>
                </a>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form onSubmit={handleReply} className="px-5 py-4 border-t border-[#E0E0E0] space-y-2">
        <textarea
          value={isi}
          onChange={(e) => setIsi(e.target.value)}
          rows={3}
          maxLength={FEEDBACK_MAX_TEXT}
          disabled={sending}
          placeholder="Tulis balasan..."
          className={`${inputClass} resize-none`}
        />
        <p className="text-[11px] text-[#9A9A9A]">
          Balasan tampil ke pengguna sebagai &quot;Dijawab oleh: {viewerNama}&quot; dan tidak bisa diubah setelah terkirim.
          {ticket.status === 'selesai' && ' Tiket ini sudah selesai; membalas tidak mengubah status.'}
        </p>
        <div className="flex items-center justify-between gap-2">
          <AttachmentPicker file={file} onChange={setFile} onError={setActionError} disabled={sending} />
          <button
            type="submit"
            disabled={sending}
            className="shrink-0 flex items-center gap-1.5 bg-madael-red text-white px-4 py-2 text-xs font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60"
          >
            <Send size={12} />
            {sending ? 'Mengirim...' : 'Kirim Balasan'}
          </button>
        </div>
        {actionError && <p className="text-xs text-red-600">{actionError}</p>}
      </form>
    </div>
  );
}
