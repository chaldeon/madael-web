'use client';

import { useState } from 'react';
import { MAX_ALASAN_TELAT } from '@/lib/attendanceStatus';

// Kotak "Alasan keterlambatan (opsional)" di layar Absensi karyawan.
// Ditampilkan hanya kalau absensi hari ini berstatus telat (status_telat dihitung
// server, termasuk toleransi). Menyimpan lewat POST /api/attendance/late-reason;
// status telat TIDAK berubah. Setelah HR menandai justified (atau tidak), alasan dikunci.
export default function LateReasonBox({ row, onSaved }) {
  const [alasan, setAlasan] = useState(row.alasan_telat || '');
  const [editing, setEditing] = useState(!row.alasan_telat);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!row.status_telat) return null;

  const reviewed = row.justified === true || row.justified === false;

  if (reviewed) {
    return (
      <div className="border border-[#E0E0E0] bg-[#F9F9F9] px-4 py-3 text-xs">
        {row.alasan_telat ? (
          <p className="text-[#6B6B6B]">
            <span className="text-black font-medium">Alasan kamu:</span> {row.alasan_telat}
          </p>
        ) : (
          <p className="text-[#6B6B6B]">Kamu tidak mengisi alasan keterlambatan.</p>
        )}
        <p className={`mt-1 font-medium ${row.justified ? 'text-green-700' : 'text-red-700'}`}>
          {row.justified ? 'HR menyetujui alasan ini.' : 'HR tidak menyetujui alasan ini.'}
        </p>
      </div>
    );
  }

  const handleSave = async () => {
    const text = alasan.trim();
    if (!text) {
      setError('Tulis alasan dulu, atau lewati saja karena ini opsional.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/attendance/late-reason', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alasan: text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan alasan.');
      setEditing(false);
      onSaved?.(json.data);
    } catch (err) {
      setError(err.message || 'Gagal menyimpan alasan. Periksa koneksi internet kamu.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="border border-[#E0E0E0] bg-[#F9F9F9] px-4 py-3 text-xs">
        <p className="text-[#6B6B6B]">
          <span className="text-black font-medium">Alasan kamu:</span> {row.alasan_telat}
        </p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[#9A9A9A]">Menunggu review HR.</span>
          <button
            type="button"
            onClick={() => { setAlasan(row.alasan_telat || ''); setEditing(true); }}
            className="text-madael-red hover:text-madael-dark font-medium"
          >
            Ubah
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-[#E0E0E0] bg-[#F9F9F9] px-4 py-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-black font-medium">Alasan keterlambatan (opsional)</span>
        <textarea
          value={alasan}
          onChange={(e) => setAlasan(e.target.value)}
          maxLength={MAX_ALASAN_TELAT}
          rows={3}
          placeholder="Mis. macet karena banjir, kendaraan mogok..."
          className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors resize-none"
        />
        <span className="text-[11px] text-[#9A9A9A]">
          {alasan.length}/{MAX_ALASAN_TELAT}. Status kamu tetap Telat; HR yang menentukan apakah alasan ini disetujui.
        </span>
      </label>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="bg-madael-red text-white px-4 py-2 text-xs font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
        >
          {saving ? 'Menyimpan...' : 'Kirim Alasan'}
        </button>
        {row.alasan_telat && (
          <button
            type="button"
            onClick={() => { setEditing(false); setError(null); }}
            className="text-xs text-[#6B6B6B] hover:text-black"
          >
            Batal
          </button>
        )}
      </div>
    </div>
  );
}
