'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Paperclip, Send } from 'lucide-react';
import { FEEDBACK_JENIS_LABEL, FEEDBACK_MAX_TEXT } from '@/lib/feedbackConfig';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import { api, formatWaktu, inputClass, StatusBadge, AttachmentPicker } from './parts';

export default function TicketThread({ id, onRead }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [isi, setIsi] = useState('');
  const [file, setFile] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const endRef = useRef(null);

  const load = useCallback(async () => {
    setLoadError('');
    const res = await api(`/api/feedback/tickets/${id}`);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    setData(res.data);
    // Membuka tiket menandai balasan sebagai dibaca di server -> segarkan badge.
    if (res.data.marked_read) onRead?.();
  }, [id, onRead]);

  useEffect(() => {
    setData(null);
    setConfirmingClose(false);
    load();
  }, [load]);

  useEffect(() => {
    if (data) endRef.current?.scrollIntoView({ block: 'end' });
  }, [data]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (sending) return;
    if (!isi.trim()) {
      setSendError('Pesan tidak boleh kosong.');
      return;
    }
    setSending(true);
    setSendError('');

    const body = new FormData();
    body.append('isi', isi.trim());
    if (file) body.append('file', file);

    const res = await api(`/api/feedback/tickets/${id}/messages`, { method: 'POST', body });
    setSending(false);
    if (!res.ok) {
      setSendError(res.error);
      return;
    }
    setIsi('');
    setFile(null);
    load();
  };

  const handleClose = async () => {
    if (closing) return;
    setClosing(true);
    setSendError('');
    const res = await api(`/api/feedback/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'selesai' }),
    });
    setClosing(false);
    setConfirmingClose(false);
    if (!res.ok) {
      setSendError(res.error);
      return;
    }
    load();
  };

  if (loadError) return <div className="p-4"><ErrorState message={loadError} onRetry={load} /></div>;
  if (!data) return <LoadingState label="Memuat tiket..." />;

  const { ticket, messages } = data;

  return (
    <div className="flex flex-col">
      <div className="px-4 py-3 border-b border-[#E0E0E0] space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[#6B6B6B]">
            #{ticket.ticket_no} · {FEEDBACK_JENIS_LABEL[ticket.jenis] || ticket.jenis} · {ticket.modul_label}
          </span>
          <StatusBadge status={ticket.status} />
        </div>

        {ticket.status === 'selesai' && ticket.closed_by_nama && (
          <p className="text-[11px] text-[#6B6B6B]">
            Ditandai selesai oleh {ticket.closed_by_self ? 'Anda' : ticket.closed_by_nama}
            {ticket.closed_at ? ` · ${formatWaktu(ticket.closed_at)}` : ''}
          </p>
        )}

        {ticket.can_close && !confirmingClose && (
          <button
            onClick={() => setConfirmingClose(true)}
            className="flex items-center gap-1.5 border border-[#E0E0E0] px-3 py-1.5 text-xs text-[#3D3D3D] hover:border-madael-red hover:text-madael-red transition-colors"
          >
            <CheckCircle2 size={13} />
            Tandai Selesai
          </button>
        )}

        {ticket.can_close && confirmingClose && (
          <div className="bg-[#F4F4F4] border border-[#E0E0E0] p-3 space-y-2">
            <p className="text-xs text-black">
              Pindahkan tiket ini ke Riwayat? Percakapan tetap tersimpan, dan tiket terbuka lagi kalau Anda mengirim pesan baru.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleClose}
                disabled={closing}
                className="bg-madael-red text-white px-3 py-1.5 text-xs font-medium hover:bg-madael-dark transition-colors disabled:opacity-60"
              >
                {closing ? 'Menyimpan...' : 'Ya, Selesai'}
              </button>
              <button
                onClick={() => setConfirmingClose(false)}
                disabled={closing}
                className="border border-[#E0E0E0] bg-white px-3 py-1.5 text-xs text-[#3D3D3D] hover:border-madael-red"
              >
                Batal
              </button>
            </div>
          </div>
        )}

        {ticket.status !== 'selesai' && !ticket.can_close && (
          <p className="text-[11px] text-[#9A9A9A]">
            Tombol &quot;Tandai Selesai&quot; muncul setelah tim support menjawab.
          </p>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={m.is_staff ? 'pr-8' : 'pl-8'}>
            <p className="text-[11px] text-[#6B6B6B] mb-1">
              {m.is_staff ? `Dijawab oleh: ${m.author_nama}` : 'Anda'} · {formatWaktu(m.created_at)}
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

      <form onSubmit={handleSend} className="px-4 py-3 border-t border-[#E0E0E0] space-y-2">
        {ticket.status === 'selesai' && (
          <p className="text-[11px] text-[#6B6B6B]">
            Tiket ini sudah selesai. Mengirim pesan baru akan membukanya kembali.
          </p>
        )}
        <textarea
          value={isi}
          onChange={(e) => setIsi(e.target.value)}
          rows={3}
          maxLength={FEEDBACK_MAX_TEXT}
          disabled={sending}
          placeholder="Tulis pesan lanjutan..."
          className={`${inputClass} resize-none`}
        />
        <p className="text-[11px] text-[#9A9A9A]">
          Pesan yang sudah terkirim tidak bisa diubah. Kalau salah ketik, kirim pesan baru untuk koreksi.
        </p>
        <div className="flex items-center justify-between gap-2">
          <AttachmentPicker file={file} onChange={setFile} onError={setSendError} disabled={sending} />
          <button
            type="submit"
            disabled={sending}
            className="shrink-0 flex items-center gap-1.5 bg-madael-red text-white px-4 py-2 text-xs font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60"
          >
            <Send size={12} />
            {sending ? 'Mengirim...' : 'Kirim'}
          </button>
        </div>
        {sendError && <p className="text-xs text-red-600">{sendError}</p>}
      </form>
    </div>
  );
}
