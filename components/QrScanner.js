'use client';

// Modal scanner QR: kamera belakang, memindai terus-menerus sampai menemukan QR
// absensi Madael, lalu memanggil onScan(teks) SEKALI dan berhenti.
//
// - Pakai BarcodeDetector bawaan browser kalau ada (Chrome/Android); kalau tidak
//   (mis. Safari iOS) jatuh ke jsQR yang membaca frame dari canvas.
// - QR yang bukan QR absensi (tidak berawalan MADAEL-ABS:) diabaikan dengan pesan;
//   validasi sebenarnya (tanda tangan, versi, lokasi) tetap di server.
// - Kamera hanya jalan selama modal terbuka dan dimatikan saat ditutup.

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import jsQR from 'jsqr';
import { looksLikeAttendanceQr } from '@/lib/attendanceQrFormat';

const SCAN_INTERVAL_MS = 150;
const MAX_DECODE_WIDTH = 640; // kecilkan frame supaya jsQR tetap ringan di HP

export default function QrScanner({ open, title, hint, onScan, onClose }) {
  const videoRef = useRef(null);
  const onScanRef = useRef(onScan);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!open) return undefined;

    let active = true;
    let stream = null;
    let timer = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const detector = 'BarcodeDetector' in window
      ? new window.BarcodeDetector({ formats: ['qr_code'] })
      : null;

    async function decode(video) {
      if (detector) {
        try {
          const codes = await detector.detect(video);
          return codes[0]?.rawValue || null;
        } catch {
          // BarcodeDetector gagal di frame ini -> coba jsQR di bawah.
        }
      }
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh || !ctx) return null;
      const scale = Math.min(1, MAX_DECODE_WIDTH / vw);
      canvas.width = Math.round(vw * scale);
      canvas.height = Math.round(vh * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || null;
    }

    async function tick() {
      if (!active) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        const text = await decode(video);
        if (!active) return;
        if (text) {
          if (looksLikeAttendanceQr(text)) {
            active = false;
            onScanRef.current?.(text);
            return;
          }
          setNotice('QR ini bukan QR absensi Madael. Arahkan ke QR absensi di lokasi kerja.');
        }
      }
      timer = setTimeout(tick, SCAN_INTERVAL_MS);
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        if (!active) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
        tick();
      })
      .catch(() => setError('Tidak bisa mengakses kamera. Pastikan izin kamera diaktifkan di browser.'));

    return () => {
      active = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      // Bersihkan pesan lama supaya pembukaan scanner berikutnya mulai bersih.
      setError(null);
      setNotice(null);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] px-6" onClick={onClose}>
      <div className="bg-white w-full max-w-[420px] p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black" aria-label="Tutup">
          <X size={18} />
        </button>
        <h2 className="text-sm font-medium text-black mb-4">{title}</h2>
        <div className="bg-black mb-4 aspect-square overflow-hidden">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        </div>
        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
        {notice && !error && <p className="text-xs text-amber-700 mb-3">{notice}</p>}
        {hint && <p className="text-xs text-[#9A9A9A]">{hint}</p>}
      </div>
    </div>
  );
}
