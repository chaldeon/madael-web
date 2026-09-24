'use client';

// Pengaturan Absensi tingkat admin. Dirender sebagai tab "Pengaturan" di
// app/employee/absensi/karyawan/page.js (khusus superadmin).
//
// Saat ini: default "Lewati layar konfirmasi" untuk SEMUA karyawan. Karyawan bisa
// menimpanya sendiri di Profil Saya → Preferensi Absensi. Disimpan lewat
// /api/attendance/settings (tabel app_settings tanpa RLS policy, hanya server).

import { useEffect, useState, useCallback } from 'react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';

function formatDiubah(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AbsensiSettingsPanel() {
  const [data, setData] = useState(null); // { lewatiKonfirmasi, jumlahOverride, updatedAt }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/attendance/settings');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal memuat pengaturan absensi.');
      setData(json);
    } catch (err) {
      setLoadError(err.message || 'Gagal memuat pengaturan absensi. Periksa koneksi internet kamu.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleToggle = async () => {
    if (!data || saving) return;
    const next = !data.lewatiKonfirmasi;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/attendance/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lewatiKonfirmasi: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan pengaturan.');
      setData((prev) => ({ ...prev, lewatiKonfirmasi: json.lewatiKonfirmasi, updatedAt: json.updatedAt }));
      setSaved(true);
    } catch (err) {
      setSaveError(err.message || 'Gagal menyimpan pengaturan. Periksa koneksi internet kamu.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState label="Memuat pengaturan absensi..." />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  const on = !!data?.lewatiKonfirmasi;
  const diubah = formatDiubah(data?.updatedAt);

  return (
    <div className="max-w-[640px]">
      <div className="bg-white border border-[#E0E0E0] p-6">
        <p className="text-sm font-medium text-black mb-1">Layar Konfirmasi Absensi</p>
        <p className="text-xs text-[#6B6B6B] mb-5">
          Sebelum absensi tersimpan, karyawan melihat layar review (jadwal, jam, foto + skor wajah, lokasi di peta) lalu
          menekan konfirmasi. Absensi di luar radius atau dengan wajah tidak cocok tetap tersimpan dan tetap muncul di tab
          Perlu Review — baik layar ini tampil maupun dilewati.
        </p>

        <div className="flex items-start justify-between gap-6">
          <div>
            <p id="label-lewati" className="text-sm text-black">Lewati layar konfirmasi</p>
            <p className="text-xs text-[#6B6B6B] mt-1 max-w-[380px]">
              {on
                ? 'Default: karyawan langsung menyimpan absensi setelah foto dan lokasi diambil, tanpa layar review.'
                : 'Default: karyawan melihat layar review dan harus menekan konfirmasi sebelum absensi tersimpan.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="label-lewati"
            onClick={handleToggle}
            disabled={saving}
            className={`relative shrink-0 w-11 h-6 transition-colors disabled:opacity-50 ${on ? 'bg-madael-red' : 'bg-[#C9C9C9]'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white transition-transform ${on ? 'translate-x-5' : ''}`}
            />
          </button>
        </div>

        <div className="mt-5 pt-4 border-t border-[#F0F0F0] space-y-1.5">
          <p className="text-xs text-[#6B6B6B]">
            Ini adalah <span className="text-black font-medium">default untuk semua karyawan</span>. Karyawan bisa menimpanya sendiri di
            Profil Saya → Preferensi Absensi.
            {data?.jumlahOverride > 0 && (
              <>
                {' '}Saat ini <span className="text-black font-medium">{data.jumlahOverride} karyawan aktif</span> memakai pilihan sendiri,
                jadi perubahan default tidak berlaku untuk mereka.
              </>
            )}
          </p>
          {diubah && <p className="text-[11px] text-[#9A9A9A]">Terakhir diubah: {diubah}</p>}
          {saving && <p className="text-xs text-[#6B6B6B]">Menyimpan...</p>}
          {saved && !saving && <p className="text-xs text-green-700">Pengaturan tersimpan.</p>}
          {saveError && <p className="text-xs text-red-600" role="alert">{saveError}</p>}
        </div>
      </div>
    </div>
  );
}