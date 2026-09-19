'use client';

// Modal kamera reusable: live preview kamera depan, ambil 1 foto (JPEG blob).
// Awalnya cuma dipakai di Absensi (app/employee/absensi/page.js), sekarang
// dipisah supaya bisa dipakai juga di Profil untuk foto referensi wajah.
//
// onCapture(blob, videoEl) dipanggil setelah foto diambil — videoEl (elemen
// <video> yang sedang live) ikut dikirim supaya pemanggil bisa langsung
// ekstrak face descriptor dari frame yang sama, tanpa perlu re-load blob-nya
// jadi <img> lagi.

import { useEffect, useRef, useState } from 'react';
import { X, Camera } from 'lucide-react';

export default function CameraCapture({
  open,
  title,
  hint,
  confirmLabel = 'Ambil Foto',
  processingLabel = 'Memproses...',
  processing = false,
  onCapture,
  onClose,
}) {
  const videoRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setError(null);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((s) => {
        if (!active) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream(s);
      })
      .catch(() => setError('Tidak bisa mengakses kamera. Pastikan izin kamera diaktifkan di browser.'));
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (stream && videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (!open && stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  }, [open, stream]);

  const stopStream = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  };

  const handleClose = () => {
    stopStream();
    onClose?.();
  };

  const handleCapture = () => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError('Gagal membuat canvas untuk foto.');
      return;
    }
    ctx.drawImage(videoEl, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('Gagal mengambil foto dari kamera.');
          return;
        }
        onCapture(blob, videoEl);
      },
      'image/jpeg',
      0.85
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] px-6" onClick={handleClose}>
      <div className="bg-white w-full max-w-[420px] p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={handleClose} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black">
          <X size={18} />
        </button>
        <h2 className="text-sm font-medium text-black mb-4">{title}</h2>
        <div className="bg-black mb-4 aspect-[3/4] overflow-hidden">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
        </div>
        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
        {hint && <p className="text-xs text-[#9A9A9A] mb-4">{hint}</p>}
        <button
          onClick={handleCapture}
          disabled={processing || !stream}
          className="w-full flex items-center justify-center gap-2 bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
        >
          <Camera size={16} />
          {processing ? processingLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}
