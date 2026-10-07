'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { friendlyCaught } from '@/lib/errorMessage';

// Preview CV pelamar langsung di halaman (iframe), tanpa buka tab baru dan
// tanpa akses Drive pribadi. PDF diambil lewat /api/applications/[id]/cv,
// dijadikan blob URL supaya error (belum login / tidak ada akses / file hilang)
// bisa ditampilkan sebagai pesan, bukan halaman JSON mentah di dalam iframe.
export default function CvPreviewModal({ applicationId, title, subtitle, onClose }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const cvUrl = `/api/applications/${applicationId}/cv`;

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = null;

    (async () => {
      try {
        const res = await fetch(cvUrl, { signal: controller.signal });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || 'Gagal memuat CV.');
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch (err) {
        if (err.name !== 'AbortError') setError(friendlyCaught(err, 'Gagal memuat CV.'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cvUrl]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-4 py-4" onClick={onClose}>
      <div
        className="bg-white w-full max-w-[960px] h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-[#E0E0E0]">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-black truncate">CV — {title}</h2>
            {subtitle && <p className="text-xs text-[#6B6B6B] truncate">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <a
              href={`${cvUrl}?download=1`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-madael-red hover:text-madael-dark"
            >
              <Download size={14} />
              Unduh
            </a>
            <button onClick={onClose} aria-label="Tutup" className="text-[#9A9A9A] hover:text-black">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-[#F4F4F4]">
          {loading && <p className="text-xs text-[#6B6B6B] p-6">Memuat CV...</p>}
          {!loading && error && <p className="text-xs text-red-600 p-6">{error}</p>}
          {!loading && blobUrl && (
            <iframe
              src={`${blobUrl}#toolbar=1&navpanes=0`}
              title={`CV ${title}`}
              className="w-full h-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
