'use client';

// Dialog kelola QR absensi untuk satu lokasi kerja (tab "Lokasi Kerja", superadmin).
// Nyalakan/matikan QR, tampilkan & cetak QR, dan "Buat Ulang QR" (QR lama langsung
// tidak berlaku). Tanda tangan QR dibuat di server lewat /api/attendance/qr/[lokasiId];
// browser hanya mengubah teks-nya jadi gambar.

import { useCallback, useEffect, useState } from 'react';
import { X, Printer, RefreshCw } from 'lucide-react';
import QRCode from 'qrcode';
import { friendlyCaught } from '@/lib/errorMessage';

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default function LokasiQrDialog({ loc, onClose, onChanged }) {
  const [info, setInfo] = useState(null); // { nama, qrEnabled, qrVersion, payload }
  const [imgUrl, setImgUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const applyInfo = useCallback(async (data) => {
    setInfo(data);
    setImgUrl(data.payload
      ? await QRCode.toDataURL(data.payload, { width: 512, margin: 2, errorCorrectionLevel: 'M' })
      : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/attendance/qr/${loc.id}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Gagal memuat QR.');
        if (!cancelled) await applyInfo(json);
      } catch (err) {
        if (!cancelled) setError(friendlyCaught(err, 'Gagal memuat QR.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loc.id, applyInfo]);

  const patch = async (body) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/attendance/qr/${loc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan perubahan QR.');
      await applyInfo(json);
      onChanged?.();
    } catch (err) {
      setError(friendlyCaught(err, 'Gagal menyimpan perubahan QR.'));
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = () => {
    if (!window.confirm('Buat ulang QR? QR yang sudah dicetak/ditempel akan langsung tidak berlaku dan harus diganti dengan yang baru.')) return;
    patch({ regenerate: true });
  };

  const handlePrint = () => {
    if (!imgUrl || !info) return;
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) {
      setError('Pop-up diblokir browser. Izinkan pop-up untuk mencetak QR.');
      return;
    }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR Absensi - ${esc(info.nama)}</title>
<style>body{font-family:Arial,sans-serif;text-align:center;padding:48px}h1{font-size:28px;margin:0 0 8px}p{color:#444;font-size:16px}img{width:420px;height:420px;margin:24px 0}</style></head>
<body><h1>Absensi Karyawan</h1><p><strong>${esc(info.nama)}</strong></p><img src="${imgUrl}" alt="QR absensi"/>
<p>Buka Portal Karyawan &rarr; Absensi &rarr; <strong>Scan QR</strong></p></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6" onClick={onClose}>
      <div className="bg-white w-full max-w-[420px] p-6 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black" aria-label="Tutup">
          <X size={18} />
        </button>
        <h2 className="text-sm font-medium text-black mb-1">QR Absensi — {loc.nama}</h2>
        <p className="text-xs text-[#6B6B6B] mb-4">
          QR ini opsi tambahan di samping absen foto. Posisi GPS karyawan tetap dicek ke radius lokasi ini;
          di luar radius, absensi tetap tercatat tapi masuk tab &quot;Perlu Review&quot;.
        </p>

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
        {loading && <p className="text-xs text-[#9A9A9A]">Memuat QR...</p>}

        {!loading && info && (
          <>
            <div className="flex items-center justify-between mb-4">
              <span
                className={`text-[10px] font-medium tracking-[0.04em] px-2 py-1 ${
                  info.qrEnabled ? 'bg-green-100 text-green-700' : 'bg-[#F4F4F4] text-[#6B6B6B]'
                }`}
              >
                {info.qrEnabled ? 'QR AKTIF' : 'QR NONAKTIF'}
              </span>
              <button
                onClick={() => patch({ enabled: !info.qrEnabled })}
                disabled={busy}
                className="text-xs underline text-[#6B6B6B] hover:text-black disabled:opacity-50"
              >
                {info.qrEnabled ? 'Matikan QR' : 'Nyalakan QR'}
              </button>
            </div>

            {imgUrl ? (
              <div className="border border-[#E0E0E0] p-3 mb-4 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL lokal dari qrcode, next/image tidak relevan */}
                <img src={imgUrl} alt={`QR absensi ${info.nama}`} className="w-56 h-56" />
              </div>
            ) : (
              <p className="text-xs text-[#6B6B6B] border border-dashed border-[#E0E0E0] p-6 mb-4 text-center">
                Nyalakan QR untuk menampilkan dan mencetaknya.
              </p>
            )}

            {imgUrl && (
              <div className="flex gap-3">
                <button
                  onClick={handlePrint}
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-madael-red text-white px-4 py-2 text-xs font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
                >
                  <Printer size={14} /> Cetak
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={busy}
                  className="flex-1 inline-flex items-center justify-center gap-2 border border-[#E0E0E0] text-black px-4 py-2 text-xs font-medium hover:border-madael-red transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={14} /> Buat Ulang
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
