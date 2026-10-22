'use client';

import { useState, useCallback } from 'react';
import { Mail, ChevronDown } from 'lucide-react';
import { friendlyCaught } from '@/lib/errorMessage';
import { EMAIL_CATEGORIES, EMAIL_CATEGORY_KEYS } from '@/lib/notificationEmailConfig';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';

// Panel "Preferensi Email" di Pusat Notifikasi: karyawan memilih kategori
// notifikasi yang juga dikirim lewat email. Data dimuat saat panel pertama kali
// dibuka, dan tiap perubahan langsung disimpan lewat /api/notification-preferences
// (dikembalikan ke nilai semula kalau gagal).
export default function NotificationEmailPreferences() {
  const [state, setState] = useState(null); // { tersedia, emailAktif, prefs }
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [savingKey, setSavingKey] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/notification-preferences', { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        setLoadError(json?.error || 'Gagal memuat preferensi email.');
      } else {
        setState(json);
      }
    } catch (err) {
      setLoadError(friendlyCaught(err, 'Gagal memuat preferensi email.'));
    }
    setLoading(false);
  }, []);

  const handleToggle = (e) => {
    if (e.currentTarget.open && !state && !loading) load();
  };

  const toggle = async (key) => {
    if (!state || savingKey) return;
    const next = !state.prefs[key];
    setSaveError(null);
    setSavingKey(key);
    setState((prev) => ({ ...prev, prefs: { ...prev.prefs, [key]: next } }));
    try {
      const res = await fetch('/api/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: next }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || 'Preferensi belum bisa disimpan.');
      setState((prev) => ({ ...prev, prefs: json.prefs }));
    } catch (err) {
      setState((prev) => ({ ...prev, prefs: { ...prev.prefs, [key]: !next } }));
      setSaveError(friendlyCaught(err, 'Preferensi belum bisa disimpan.'));
    }
    setSavingKey(null);
  };

  return (
    <details onToggle={handleToggle} className="group bg-white border border-[#E0E0E0] mb-6">
      <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none select-none">
        <span className="flex items-center gap-2 text-sm font-medium text-black">
          <Mail size={16} className="text-madael-red" />
          Preferensi Email
        </span>
        <ChevronDown size={16} className="text-[#9A9A9A] transition-transform group-open:rotate-180" />
      </summary>

      <div className="border-t border-[#E0E0E0] px-4 py-4">
        {loading && <LoadingState label="Memuat preferensi..." />}

        {!loading && loadError && <ErrorState message={loadError} onRetry={load} />}

        {!loading && !loadError && state && !state.tersedia && (
          <p className="text-xs text-[#6B6B6B]">
            Preferensi email belum bisa diatur karena database belum diperbarui. Hubungi admin.
          </p>
        )}

        {!loading && !loadError && state?.tersedia && (
          <>
            <p className="text-xs text-[#6B6B6B] mb-1">
              Pilih notifikasi yang juga dikirim ke email akunmu. Notifikasi di dalam aplikasi tetap muncul.
            </p>
            {!state.emailAktif && (
              <p className="text-xs text-[#9A9A9A] mb-1">
                Pengiriman email belum diaktifkan di server. Pilihanmu tetap tersimpan dan berlaku begitu email aktif.
              </p>
            )}
            {saveError && <p className="text-xs text-red-600 mt-2">{saveError}</p>}

            <ul className="divide-y divide-[#E0E0E0]">
              {EMAIL_CATEGORY_KEYS.map((key) => {
                const def = EMAIL_CATEGORIES[key];
                const on = state.prefs[key];
                return (
                  <li key={key} className="flex items-start justify-between gap-4 py-3">
                    <div>
                      <p className="text-sm text-black">{def.label}</p>
                      <p className="text-xs text-[#6B6B6B] mt-0.5">{def.description}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`Email ${def.label}`}
                      onClick={() => toggle(key)}
                      disabled={savingKey !== null}
                      className={`relative shrink-0 mt-0.5 h-5 w-9 rounded-full transition-colors cursor-pointer disabled:opacity-60 ${
                        on ? 'bg-madael-red' : 'bg-[#D0D0D0]'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                          on ? 'translate-x-4' : ''
                        }`}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}
