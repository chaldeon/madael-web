'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { useModalDismiss } from '@/lib/useModalDismiss';

// Dialog konfirmasi bersama — pengganti window.confirm() dan window.prompt()
// supaya gayanya sama dengan modal konfirmasi di Employee List (bukan dialog
// bawaan browser, yang jelek di ponsel dan tidak bisa diberi input teks).
//
// Komponen ini "terkontrol": pemanggil menyimpan state-nya sendiri (target yang
// mau diproses, teks input, status busy) dan menutup dialog setelah aksi selesai.
// Pola ini sama dengan modal Nonaktifkan/Aktifkan di app/employee/list/page.js.
//
// Pemakaian dasar:
//   <ConfirmDialog
//     open={!!deleteTarget}
//     title="Hapus Pengumuman"
//     message={<>Hapus pengumuman <strong>{deleteTarget?.judul}</strong>?</>}
//     confirmLabel="Hapus"
//     busy={actingId === deleteTarget?.id}
//     onConfirm={handleConfirmDelete}
//     onCancel={() => setDeleteTarget(null)}
//   />
//
// Props:
// - open: boolean, dialog tampil atau tidak.
// - title, message: teks dialog. `message` boleh berupa elemen React, tapi isi
//   inline saja (dibungkus <p>), jangan elemen blok.
// - confirmLabel / cancelLabel / busyLabel: teks tombol. busyLabel menggantikan
//   confirmLabel selama `busy`.
// - busy: boolean. Saat true, tombol konfirmasi dan semua jalan keluar (Batal,
//   X, Esc, klik di luar) dinonaktifkan supaya aksi yang sedang jalan tidak
//   terpotong dan tidak bisa dikirim dua kali.
// - onConfirm: dipanggil saat tombol konfirmasi diklik. Dialog TIDAK menutup
//   sendiri; pemanggil yang menutupnya (setelah sukses, atau langsung kalau
//   aksinya sinkron).
// - onCancel: dipanggil saat Batal / X / Esc / klik di luar.
// - Opsi textarea (pengganti prompt): isi `onChange` untuk memunculkannya.
//   inputLabel, inputPlaceholder, inputMaxLength opsional; `value` adalah teks
//   saat ini; `onChange` menerima STRING baru (bukan event).
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Ya, Lanjutkan',
  cancelLabel = 'Batal',
  busyLabel = 'Memproses...',
  busy = false,
  onConfirm,
  onCancel,
  inputLabel,
  inputPlaceholder,
  inputMaxLength,
  value = '',
  onChange,
}) {
  const titleId = useId();
  const messageId = useId();
  const inputId = useId();
  const cancelRef = useRef(null);
  const inputRef = useRef(null);
  const hasInput = typeof onChange === 'function';

  const handleCancel = useCallback(() => {
    if (!busy && onCancel) onCancel();
  }, [busy, onCancel]);

  // Dialog read-only dari sisi hook (`false`): Esc dan klik di luar langsung
  // menutup tanpa window.confirm lagi. Kalau ada textarea, teks yang sudah
  // diketik memang ikut hilang saat dibatalkan, sama seperti prompt() dulu.
  const handleBackdropClick = useModalDismiss(open, handleCancel, false);

  // Fokus awal: ke textarea kalau ada (langsung bisa mengetik). Kalau tidak,
  // ke tombol Batal supaya Enter/Spasi tidak sengaja mengeksekusi aksi
  // merusak seperti hapus. Fokus dikembalikan ke elemen pemicu saat ditutup.
  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const target = hasInput ? inputRef.current : cancelRef.current;
    if (target) target.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [open, hasInput]);

  if (!open) return null;

  return (
    // z-[1050]: di atas modal biasa (z-[1000]) karena dialog ini sering muncul
    // dari dalam modal lain (mis. konfirmasi kirim pesan), tapi tetap di bawah
    // Toast (z-[1100]).
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1050] px-6"
      onClick={handleBackdropClick}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        className="w-full max-w-[420px] bg-white border-t-4 border-madael-red p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id={titleId} className="font-serif text-[20px] font-normal text-black">
            {title}
          </h2>
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            aria-label="Tutup"
            className="text-[#6B6B6B] hover:text-black disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        {message && (
          <p id={messageId} className={`text-sm text-black ${hasInput ? 'mb-4' : 'mb-6'}`}>
            {message}
          </p>
        )}

        {hasInput && (
          <div className="mb-6">
            {inputLabel && (
              <label htmlFor={inputId} className="block text-xs font-medium text-[#3D3D3D] mb-1.5">
                {inputLabel}
              </label>
            )}
            <textarea
              id={inputId}
              ref={inputRef}
              rows={3}
              value={value}
              maxLength={inputMaxLength}
              placeholder={inputPlaceholder}
              disabled={busy}
              onChange={(e) => onChange(e.target.value)}
              className="w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors resize-y disabled:opacity-60"
            />
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            ref={cancelRef}
            onClick={handleCancel}
            disabled={busy}
            className="flex-1 border border-[#E0E0E0] text-black px-6 py-3 text-sm font-medium tracking-[0.04em] hover:border-black transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 bg-madael-red text-white px-6 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
