'use client';

import { STATUS_STYLE } from '@/lib/peraturanConfig';

export const inputClass =
  'w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
export const labelClass = 'block text-xs font-medium text-[#6B6B6B] mb-1';

export function StatusBadge({ status }) {
  return (
    <span
      className={`text-[10px] font-medium tracking-[0.04em] px-2 py-0.5 shrink-0 uppercase ${
        STATUS_STYLE[status] || 'bg-[#F4F4F4] text-[#6B6B6B]'
      }`}
    >
      {status}
    </span>
  );
}

// Chip keyword/topik. Kalau `onClick` diberikan, chip jadi tombol filter.
export function Chip({ label, onClick, active = false, count, onRemove }) {
  const base = 'inline-flex items-center gap-1 text-xs px-2.5 py-1 border transition-colors';
  const tone = active
    ? 'bg-madael-red border-madael-red text-white'
    : 'bg-white border-[#E0E0E0] text-[#3D3D3D]';

  if (!onClick && !onRemove) {
    return <span className={`${base} ${tone}`}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick || onRemove}
      className={`${base} ${tone} ${active ? 'hover:bg-madael-dark' : 'hover:border-madael-red hover:text-madael-red'}`}
      aria-pressed={onClick ? active : undefined}
    >
      {label}
      {count != null && <span className={active ? 'text-white/80' : 'text-[#9A9A9A]'}>{count}</span>}
      {onRemove && <span aria-hidden="true">×</span>}
    </button>
  );
}

// Cuplikan hasil pencarian dari RPC cari_peraturan: bagian yang cocok dibungkus
// karakter kontrol \u0002 ... \u0003. Dirender sebagai teks React (bukan HTML).
export function Cuplikan({ text }) {
  if (!text) return null;
  const parts = String(text).split(/\u0002|\u0003/);
  return (
    <p className="text-xs text-[#6B6B6B] mt-1 line-clamp-2">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-yellow-100 text-black">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </p>
  );
}
