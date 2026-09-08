'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

const MIN_LENGTH = 8;

function checkPasswordRules(pw) {
  return {
    length: pw.length >= MIN_LENGTH,
    lowercase: /[a-z]/.test(pw),
    uppercase: /[A-Z]/.test(pw),
    digit: /[0-9]/.test(pw),
  };
}

function passwordStrengthLabel(rules) {
  const passedCount = Object.values(rules).filter(Boolean).length;
  if (passedCount <= 1) return { label: 'Lemah', color: 'bg-red-500', width: '33%' };
  if (passedCount <= 3) return { label: 'Sedang', color: 'bg-amber-500', width: '66%' };
  return { label: 'Kuat', color: 'bg-green-600', width: '100%' };
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const portal = searchParams.get('portal') === 'admin' ? 'admin' : 'employee';
  const loginPath = portal === 'admin' ? '/login' : '/employee/login';

  // "checking" -> masih memvalidasi link recovery dari email
  // "ready"    -> link valid, tampilkan form set password baru
  // "invalid"  -> link tidak valid/kedaluwarsa
  // "success"  -> password berhasil diubah
  const [stage, setStage] = useState('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    // Klik link recovery dari email otomatis memicu event PASSWORD_RECOVERY
    // begitu Supabase client mendeteksi token di URL dan membentuk sesi
    // sementara. Ini cara resmi Supabase untuk tahu "sesi ini boleh dipakai
    // ganti password", bukan sesi login biasa.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setStage('ready');
      }
    });

    // Fallback: kalau halaman ini di-reload setelah sesi recovery terbentuk,
    // event di atas tidak akan terpanggil ulang — cek sesi yang sudah ada.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setStage((prev) => (prev === 'ready' ? prev : session ? 'ready' : 'invalid'));
    });

    // Kalau setelah beberapa detik belum ada event/sesi sama sekali,
    // simpulkan link tidak valid/kedaluwarsa daripada loading selamanya.
    const timeout = setTimeout(() => {
      setStage((prev) => (prev === 'checking' ? 'invalid' : prev));
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const inputClass =
    'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';

  const rules = checkPasswordRules(password);
  const allRulesPassed = Object.values(rules).every(Boolean);
  const strength = passwordStrengthLabel(rules);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!rules.length) {
      setError(`Password minimal ${MIN_LENGTH} karakter.`);
      return;
    }
    if (!rules.lowercase || !rules.uppercase || !rules.digit) {
      setError('Password harus mengandung huruf besar, huruf kecil, dan angka.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Konfirmasi password tidak cocok.');
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      setError(error.message || 'Gagal mengubah password, coba lagi.');
      return;
    }
    setStage('success');
  };

  return (
    <section className="min-h-[calc(100vh-68px)] flex items-center justify-center bg-black px-6">
      <div className="w-full max-w-[380px] border-t-4 border-madael-red bg-white p-8">
        <h1 className="font-serif text-[24px] font-normal text-black tracking-[-0.02em] mb-1">
          Atur Password Baru
        </h1>

        {stage === 'checking' && (
          <p className="text-sm text-[#6B6B6B] mt-4">Memvalidasi link...</p>
        )}

        {stage === 'invalid' && (
          <div className="mt-4 space-y-5">
            <p className="text-sm text-black bg-[#F4F4F4] border border-[#E0E0E0] px-4 py-3">
              Link reset password ini tidak valid atau sudah kedaluwarsa. Silakan minta link baru.
            </p>
            <Link
              href={`/forgot-password?portal=${portal}`}
              className="block text-center w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
            >
              Minta Link Baru
            </Link>
          </div>
        )}

        {stage === 'success' && (
          <div className="mt-4 space-y-5">
            <p className="text-sm text-black bg-[#F4F4F4] border border-[#E0E0E0] px-4 py-3">
              Password berhasil diubah. Silakan login dengan password baru Anda.
            </p>
            <button
              onClick={() => router.push(loginPath)}
              className="w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
            >
              Ke Halaman Login
            </button>
          </div>
        )}

        {stage === 'ready' && (
          <form onSubmit={handleSubmit} className="space-y-5 mt-4">
            <div>
              <label htmlFor="password" className={labelClass}>Password Baru</label>
              <input
                id="password"
                type="password"
                required
                minLength={MIN_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />

              {password.length > 0 && (
                <div className="mt-2">
                  <div className="h-1.5 w-full bg-[#E0E0E0] overflow-hidden">
                    <div
                      className={`h-full ${strength.color} transition-all`}
                      style={{ width: strength.width }}
                    />
                  </div>
                  <p className="text-[11px] text-[#6B6B6B] mt-1">Kekuatan: {strength.label}</p>
                </div>
              )}

              <ul className="mt-2 space-y-0.5">
                <li className={`text-[11px] ${rules.length ? 'text-green-700' : 'text-[#9A9A9A]'}`}>
                  {rules.length ? '✓' : '○'} Minimal {MIN_LENGTH} karakter
                </li>
                <li className={`text-[11px] ${rules.uppercase ? 'text-green-700' : 'text-[#9A9A9A]'}`}>
                  {rules.uppercase ? '✓' : '○'} Huruf besar (A-Z)
                </li>
                <li className={`text-[11px] ${rules.lowercase ? 'text-green-700' : 'text-[#9A9A9A]'}`}>
                  {rules.lowercase ? '✓' : '○'} Huruf kecil (a-z)
                </li>
                <li className={`text-[11px] ${rules.digit ? 'text-green-700' : 'text-[#9A9A9A]'}`}>
                  {rules.digit ? '✓' : '○'} Angka (0-9)
                </li>
              </ul>
            </div>

            <div>
              <label htmlFor="confirmPassword" className={labelClass}>Konfirmasi Password Baru</label>
              <input
                id="confirmPassword"
                type="password"
                required
                minLength={MIN_LENGTH}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </div>

            {error && <p className="text-sm text-madael-red">{error}</p>}

            <button
              type="submit"
              disabled={saving || !allRulesPassed}
              className="w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? 'Menyimpan...' : 'Simpan Password Baru'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}