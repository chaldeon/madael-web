'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase-browser';
import { useLanguage } from '@/context/LanguageContext';

// Minimal 8 karakter, ada huruf kecil, huruf besar, dan angka.
// Samakan dengan aturan panjang minimum di Supabase Dashboard
// (Authentication > Policies > Password minimum length = 8).
const PASSWORD_RULES = [
  { key: 'length', test: (v) => v.length >= 8, id: 'Minimal 8 karakter', en: 'At least 8 characters' },
  { key: 'lower', test: (v) => /[a-z]/.test(v), id: 'Ada huruf kecil (a-z)', en: 'Contains a lowercase letter' },
  { key: 'upper', test: (v) => /[A-Z]/.test(v), id: 'Ada huruf besar (A-Z)', en: 'Contains an uppercase letter' },
  { key: 'digit', test: (v) => /[0-9]/.test(v), id: 'Ada angka (0-9)', en: 'Contains a digit' },
];

export default function EmployeeResetPasswordPage() {
  const router = useRouter();
  const { lang } = useLanguage();

  // 'checking' -> 'ready' (link valid, tampilkan form) -> 'invalid' (link expired/salah)
  const [status, setStatus] = useState('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const inputClass =
    'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';

  useEffect(() => {
    const supabase = createClient();

    // Link recovery dari Supabase memicu event PASSWORD_RECOVERY begitu
    // client selesai membaca token dari URL. Kita dengarkan event ini
    // daripada langsung cek getSession(), karena parsing token di URL
    // berjalan async saat client pertama kali dibuat.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session) {
        setStatus('ready');
      }
    });

    // Kalau link sudah expired/invalid, Supabase redirect balik dengan
    // ?error=access_denied&error_code=otp_expired di URL (bukan event).
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace('#', '?'));
    if (params.get('error') || hashParams.get('error')) {
      setStatus('invalid');
    }

    // Fallback: kalau ternyata session recovery sudah ada duluan
    // sebelum listener terpasang (mis. karena render ulang cepat).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && status === 'checking') {
        setStatus('ready');
      }
    });

    // Timeout wajar: kalau setelah beberapa detik tidak ada event & tidak ada
    // session sama sekali, anggap link tidak valid.
    const timeout = setTimeout(() => {
      setStatus((current) => (current === 'checking' ? 'invalid' : current));
    }, 4000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const failedRules = PASSWORD_RULES.filter((rule) => !rule.test(password));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (failedRules.length > 0) {
      setError(
        lang === 'id'
          ? 'Password belum memenuhi semua syarat di bawah.'
          : 'Password does not meet all the requirements below.'
      );
      return;
    }

    if (password !== confirmPassword) {
      setError(lang === 'id' ? 'Konfirmasi password tidak sama.' : 'Password confirmation does not match.');
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    // Putuskan sesi recovery sementara ini supaya user login ulang
    // dengan password barunya (sesuai keputusan: balik ke halaman login).
    await supabase.auth.signOut();
    setDone(true);
    setLoading(false);

    setTimeout(() => {
      router.push('/employee/login?reset=success');
    }, 1500);
  };

  if (status === 'checking') {
    return (
      <section className="min-h-[calc(100vh-68px)] flex items-center justify-center bg-black">
        <p className="text-sm text-white/60">{lang === 'id' ? 'Memeriksa link...' : 'Verifying link...'}</p>
      </section>
    );
  }

  if (status === 'invalid') {
    return (
      <section className="min-h-[calc(100vh-68px)] flex items-center justify-center bg-black px-6">
        <div className="w-full max-w-[380px] border-t-4 border-madael-red bg-white p-8 text-center">
          <h1 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] mb-3">
            {lang === 'id' ? 'Link Tidak Valid' : 'Invalid Link'}
          </h1>
          <p className="text-sm text-[#6B6B6B] mb-6 leading-relaxed">
            {lang === 'id'
              ? 'Link reset password sudah kedaluwarsa atau tidak valid. Silakan minta link baru.'
              : 'This password reset link has expired or is invalid. Please request a new one.'}
          </p>
          <a
            href="/employee/forgot-password"
            className="block w-full text-center bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            {lang === 'id' ? 'Minta Link Baru' : 'Request New Link'}
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-[calc(100vh-68px)] flex items-center justify-center bg-black px-6">
      <div className="w-full max-w-[380px] border-t-4 border-madael-red bg-white p-8">
        <div className="flex justify-center mb-6">
          <Image
            src="/logos/madael_logo_transparent.png"
            alt="Madael Consult"
            width={56}
            height={56}
            className="object-contain"
          />
        </div>

        <h1 className="font-serif text-[24px] font-normal text-black tracking-[-0.02em] mb-1 text-center">
          {lang === 'id' ? 'Buat Password Baru' : 'Set New Password'}
        </h1>

        {done ? (
          <p className="text-sm text-[#3D3D3D] text-center leading-relaxed mt-4">
            {lang === 'id'
              ? 'Password berhasil diubah. Mengarahkan ke halaman login...'
              : 'Password changed successfully. Redirecting to login...'}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 mt-6">
            <div>
              <label htmlFor="password" className={labelClass}>
                {lang === 'id' ? 'Password Baru' : 'New Password'}
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>

            <ul className="space-y-1 -mt-2">
              {PASSWORD_RULES.map((rule) => {
                const passed = rule.test(password);
                return (
                  <li
                    key={rule.key}
                    className={`text-xs flex items-center gap-1.5 ${
                      passed ? 'text-green-600' : 'text-[#8A8A8A]'
                    }`}
                  >
                    <span>{passed ? '✓' : '·'}</span>
                    <span>{lang === 'id' ? rule.id : rule.en}</span>
                  </li>
                );
              })}
            </ul>

            <div>
              <label htmlFor="confirmPassword" className={labelClass}>
                {lang === 'id' ? 'Konfirmasi Password' : 'Confirm Password'}
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </div>

            {error && <p className="text-sm text-madael-red">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading
                ? lang === 'id' ? 'Menyimpan...' : 'Saving...'
                : lang === 'id' ? 'Simpan Password' : 'Save Password'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}