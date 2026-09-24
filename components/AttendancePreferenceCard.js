'use client';

// Kartu "Preferensi Absensi" di Profil Saya: karyawan memilih sendiri apakah
// layar konfirmasi absensi ditampilkan. Pilihan ini MENIMPA default admin
// (Kelola Absensi Tim → Pengaturan). Disimpan langsung lewat
// /api/attendance/preferences — bukan lewat alur pengajuan perubahan profil,
// karena ini preferensi pribadi, bukan data HR yang perlu disetujui.

import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2 } from 'lucide-react';

export default function AttendancePreferenceCard() {
  const [pref, setPref] = useState(null); // { adminDefault, override, lewati, tersedia }
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/attendance/preferences');
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal memuat preferensi absensi.');
      setPref(json);
    } catch (err) {
      setLoadError(err.message || 'Gagal memuat preferensi absensi. Periksa koneksi internet kamu.');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const choose = async (override) => {
    if (!pref || saving || pref.override === override) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/attendance/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan preferensi.');
      setPref(json);
      setSaved(true);
    } catch (err) {
      setSaveError(err.message || 'Gagal menyimpan preferensi. Periksa koneksi internet kamu.');
    } finally {
      setSaving(false);
    }
  };

  const adminLabel = pref?.adminDefault ? 'dilewati' : 'ditampilkan';
  const options = [
    { value: null, title: 'Ikuti pengaturan admin', hint: pref ? `Saat ini default admin: layar konfirmasi ${adminLabel}.` : '' },
    { value: false, title: 'Selalu tampilkan layar konfirmasi', hint: 'Kamu meninjau ringkasan dulu sebelum absensi tersimpan.' },
    { value: true, title: 'Selalu lewati layar konfirmasi', hint: 'Absensi langsung tersimpan setelah foto dan lokasi diambil.' },
  ];

  return (
    <div id="preferensi-absensi" className="bg-white border border-[#E0E0E0] p-5 mb-6">
      <p className="text-xs font-semibold text-black tracking-[0.02em] mb-1">Preferensi Absensi</p>
      <p className="text-xs text-[#6B6B6B] mb-4">
        Atur apakah kamu melihat layar review sebelum absensi tersimpan. Pilihanmu menimpa pengaturan default dari admin.
        Absensi di luar radius atau dengan wajah tidak cocok tetap tersimpan dan masuk daftar review admin, apa pun pilihanmu.
      </p>

      {loadError && (
        <p className="text-xs text-red-600" role="alert">
          {loadError}{' '}
          <button type="button" onClick={load} className="underline font-medium">Coba lagi</button>
        </p>
      )}

      {!pref && !loadError && <p className="text-xs text-[#9A9A9A]">Memuat...</p>}

      {pref && pref.tersedia === false && (
        <p className="text-xs text-[#6B6B6B]">
          Pengaturan ini belum tersedia. Hubungi superadmin — layar konfirmasi tetap ditampilkan untuk sementara.
        </p>
      )}

      {pref && pref.tersedia !== false && (
        <div role="radiogroup" aria-label="Layar konfirmasi absensi" className="space-y-2">
          {options.map((opt) => {
            const active = pref.override === opt.value;
            return (
              <label
                key={String(opt.value)}
                className={`flex items-start gap-3 border px-4 py-3 cursor-pointer transition-colors ${
                  active ? 'border-madael-red bg-[#FFF8F8]' : 'border-[#E0E0E0] hover:border-[#C9C9C9]'
                } ${saving ? 'opacity-60' : ''}`}
              >
                <input
                  type="radio"
                  name="pref-konfirmasi-absensi"
                  checked={active}
                  disabled={saving}
                  onChange={() => choose(opt.value)}
                  className="mt-0.5 accent-madael-red"
                />
                <span>
                  <span className="block text-sm text-black">{opt.title}</span>
                  {opt.hint && <span className="block text-xs text-[#6B6B6B] mt-0.5">{opt.hint}</span>}
                </span>
              </label>
            );
          })}
          <div className="min-h-[18px]">
            {saved && !saving && (
              <p className="flex items-center gap-1.5 text-xs text-green-700">
                <CheckCircle2 size={13} /> Tersimpan. Sekarang layar konfirmasi{' '}
                {pref.lewati ? 'dilewati' : 'ditampilkan'}{pref.sumber === 'admin' ? ' (mengikuti admin).' : '.'}
              </p>
            )}
            {saveError && <p className="text-xs text-red-600" role="alert">{saveError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}