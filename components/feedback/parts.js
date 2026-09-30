'use client';

import { useRef } from 'react';
import { Check, Paperclip, X } from 'lucide-react';
import {
  FEEDBACK_ALLOWED_MIME, FEEDBACK_MAX_FILE, FEEDBACK_STATUS_LABEL,
} from '@/lib/feedbackConfig';

export const inputClass =
  'w-full border border-[#E0E0E0] bg-white px-3 py-2 text-sm text-black focus:outline-none focus:border-madael-red disabled:bg-[#F4F4F4]';

export function formatWaktu(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// fetch JSON yang tahan banting: body non-JSON (401/proxy/500 di luar handler)
// tidak melempar error, tapi jadi pesan yang terbaca.
export async function api(url, options) {
  try {
    const res = await fetch(url, options);
    let data = null;
    try { data = await res.json(); } catch { /* bukan JSON */ }
    if (!res.ok) {
      return { ok: false, data, error: data?.error || `Server merespons status ${res.status}.` };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, data: null, error: 'Koneksi bermasalah. Coba lagi.' };
  }
}

const STATUS_STYLE = {
  baru: 'bg-madael-red text-white',
  diproses: 'bg-[#FFF3CD] text-[#7A5C00]',
  selesai: 'bg-[#2E7D32] text-white',
};

export function StatusBadge({ status }) {
  return (
    <span className={`text-[10px] font-medium tracking-[0.04em] px-2 py-0.5 ${STATUS_STYLE[status] || STATUS_STYLE.selesai}`}>
      {(FEEDBACK_STATUS_LABEL[status] || status).toUpperCase()}
    </span>
  );
}

// Penanda "siapa yang terakhir bicara" untuk tiket aktif (tiket selesai cukup
// pakai StatusBadge). Sisi admin: perlu dibalas / sudah dijawab. Sisi pengguna:
// sudah dijawab / menunggu jawaban.
export function ReplyMarker({ ticket, viewer }) {
  if (ticket.status === 'selesai') return null;
  const base = 'inline-flex items-center gap-1 text-[10px] font-medium tracking-[0.04em] px-2 py-0.5';

  if (ticket.last_message_is_staff) {
    return (
      <span className={`${base} bg-[#E3F0FF] text-[#1D4E89]`}>
        <Check size={10} strokeWidth={3} />
        SUDAH DIJAWAB
      </span>
    );
  }
  return viewer === 'admin' ? (
    <span className={`${base} border border-madael-red bg-white text-madael-red`}>PERLU DIBALAS</span>
  ) : (
    <span className={`${base} bg-[#F4F4F4] text-[#6B6B6B]`}>MENUNGGU JAWABAN</span>
  );
}

export function AttachmentPicker({ file, onChange, onError, disabled }) {
  const inputRef = useRef(null);

  const handlePick = (e) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    if (!FEEDBACK_ALLOWED_MIME.includes(picked.type)) {
      onError('Lampiran harus gambar JPG, PNG, atau WEBP.');
      return;
    }
    if (picked.size > FEEDBACK_MAX_FILE) {
      onError('Ukuran lampiran maksimal 4MB.');
      return;
    }
    onError('');
    onChange(picked);
  };

  return (
    <div className="flex items-center gap-2 min-w-0">
      <input ref={inputRef} type="file" accept={FEEDBACK_ALLOWED_MIME.join(',')} onChange={handlePick} className="hidden" />
      {file ? (
        <span className="flex items-center gap-1.5 text-xs text-[#3D3D3D] bg-[#F4F4F4] px-2 py-1 min-w-0">
          <Paperclip size={12} className="shrink-0" />
          <span className="truncate max-w-[160px]">{file.name}</span>
          <button type="button" onClick={() => onChange(null)} disabled={disabled} aria-label="Hapus lampiran" className="text-[#6B6B6B] hover:text-black">
            <X size={12} />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="flex items-center gap-1.5 text-xs text-[#6B6B6B] hover:text-madael-red disabled:opacity-50"
        >
          <Paperclip size={14} />
          Lampirkan screenshot (opsional)
        </button>
      )}
    </div>
  );
}
