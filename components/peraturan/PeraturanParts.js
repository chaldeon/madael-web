'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { STATUS_STYLE, RELASI_LABEL, RELASI_PENGGANTI, labelPeraturan } from '@/lib/peraturanConfig';

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

// Gaya peringatan per status. Berlaku tidak punya peringatan.
const PERINGATAN_STYLE = {
  Dicabut: {
    box: 'bg-red-50 border-red-200 text-red-800',
    pesan: 'Peraturan ini sudah dicabut dan tidak lagi berlaku.',
    kosong: 'Belum tercatat peraturan yang mencabutnya di perpustakaan ini.',
  },
  Diubah: {
    box: 'bg-amber-50 border-amber-200 text-amber-800',
    pesan: 'Peraturan ini sudah diubah. Sebagian isinya mungkin tidak lagi berlaku; rujuk peraturan yang mengubahnya.',
    kosong: 'Belum tercatat peraturan yang mengubahnya di perpustakaan ini.',
  },
};

// Banner di halaman detail untuk peraturan berstatus Dicabut/Diubah, dengan
// tautan ke peraturan yang mencabut/mengubahnya.
// pengganti: [{ id, ref, catatan }] (item relasi masuk). loadError: relasi gagal
// dimuat, jadi "belum tercatat" tidak boleh diklaim.
export function BannerPeringatanStatus({ status, pengganti = [], loadError = '', onRetry }) {
  const gaya = PERINGATAN_STYLE[status];
  if (!gaya) return null;
  const label = RELASI_LABEL[RELASI_PENGGANTI[status]].masuk;

  return (
    <div className={`mt-4 border px-4 py-3 text-sm ${gaya.box}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium">{gaya.pesan}</p>
          {loadError ? (
            <p className="mt-1">
              Peraturan pengganti belum bisa dimuat.{' '}
              {onRetry && (
                <button type="button" onClick={onRetry} className="underline font-medium">
                  Coba lagi
                </button>
              )}
            </p>
          ) : pengganti.length > 0 ? (
            <div className="mt-1">
              <span>{label}:</span>
              <ul className="mt-1 space-y-1">
                {pengganti.map((item) => (
                  <li key={item.id}>
                    <Link href={`/employee/peraturan/${item.ref.id}`} className="font-medium underline">
                      {labelPeraturan(item.ref)}
                    </Link>
                    <span> — {item.ref.judul}</span>
                    {item.ref.status && item.ref.status !== 'Berlaku' && (
                      <span className="ml-2 align-middle"><StatusBadge status={item.ref.status} /></span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-1">{gaya.kosong}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Penanda ringkas di kartu halaman daftar. pengganti: undefined = relasi belum
// termuat (atau gagal dimuat) -> hanya teks status; array = hasil sebenarnya.
const PENANDA_MAKS_NAMA = 2;
export function PenandaPeringatanStatus({ status, pengganti }) {
  const gaya = PERINGATAN_STYLE[status];
  if (!gaya) return null;
  const teks = status === 'Dicabut' ? 'Sudah tidak berlaku' : 'Telah diubah';
  const label = RELASI_LABEL[RELASI_PENGGANTI[status]].masuk;
  const tampil = (pengganti || []).slice(0, PENANDA_MAKS_NAMA);
  const sisa = (pengganti || []).length - tampil.length;

  return (
    <p className={`mt-2 inline-flex flex-wrap items-center gap-x-1.5 border px-2 py-1 text-xs ${gaya.box}`}>
      <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />
      <span className="font-medium">{teks}</span>
      {pengganti && tampil.length > 0 && (
        <>
          <span>· {label}</span>
          {tampil.map((item, i) => (
            <span key={item.id}>
              <Link href={`/employee/peraturan/${item.ref.id}`} className="underline">
                {labelPeraturan(item.ref)}
              </Link>
              {i < tampil.length - 1 ? ',' : ''}
            </span>
          ))}
          {sisa > 0 && <span>+{sisa} lainnya</span>}
        </>
      )}
      {pengganti && pengganti.length === 0 && <span>· belum tercatat pengganti</span>}
    </p>
  );
}
