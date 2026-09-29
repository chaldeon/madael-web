'use client';

import { useEffect } from 'react';
import { X, AlertCircle, CheckCircle2 } from 'lucide-react';

// Banner notifikasi non-blocking — pengganti alert() supaya gayanya konsisten
// sama modal custom lain di halaman ini (bukan dialog browser native).
// Auto-dismiss setelah beberapa detik, tapi tetap bisa ditutup manual.
export default function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onDismiss, toast.type === 'error' ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;
  const isError = toast.type === 'error';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-5 right-5 z-[1100] max-w-[380px] flex items-start gap-2.5 px-4 py-3.5 shadow-lg border-l-4 bg-white ${
        isError ? 'border-madael-red' : 'border-[#166534]'
      }`}
    >
      {isError ? (
        <AlertCircle size={18} className="text-madael-red shrink-0 mt-0.5" />
      ) : (
        <CheckCircle2 size={18} className="text-[#166534] shrink-0 mt-0.5" />
      )}
      <p className="text-sm text-black flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Tutup notifikasi"
        className="text-[#9A9A9A] hover:text-black shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}
