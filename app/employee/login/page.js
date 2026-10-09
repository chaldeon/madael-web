'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useLanguage } from '@/context/LanguageContext';

const DEFAULT_REDIRECT = '/employee/dashboard';

// Validasi tujuan dari ?redirectedFrom supaya tidak jadi open redirect:
// hanya path internal yang diawali /employee (bukan halaman login itu sendiri).
function getSafeRedirect(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return DEFAULT_REDIRECT;
  try {
    const base = 'http://localhost';
    const url = new URL(raw, base);
    const inEmployee = url.pathname === '/employee' || url.pathname.startsWith('/employee/');
    if (url.origin !== base || !inEmployee || url.pathname.startsWith('/employee/login')) {
      return DEFAULT_REDIRECT;
    }
    return url.pathname + url.search + url.hash;
  } catch {
    return DEFAULT_REDIRECT;
  }
}

function EmployeeLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const { lang } = useLanguage();
  const resetSuccess = searchParams.get('reset') === 'success';
  const activatedSuccess = searchParams.get('activated') === 'success';
  const redirectTo = getSafeRedirect(searchParams.get('redirectedFrom'));

  useEffect(() => {
    const checkSession = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        router.push(redirectTo);
        return;
      }
      setCheckingSession(false);
    };
    checkSession();
  }, [router, redirectTo]);

  const inputClass =
    'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(lang === 'id' ? 'Email atau password salah.' : 'Invalid email or password.');
      setLoading(false);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  };

  if (checkingSession) {
    return (
      <section className="min-h-[calc(100vh-68px)] flex items-center justify-center bg-black">
        <p className="text-sm text-white/60">
          {lang === 'id' ? 'Memuat...' : 'Loading...'}
        </p>
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
          {lang === 'id' ? 'Masuk' : 'Login'}
        </h1>
        <p className="text-sm text-[#6B6B6B] mb-1 text-center">Madael Consult</p>
        <p className="text-xs text-[#8A8A8A] mb-6 text-center leading-relaxed">
          {lang === 'id'
            ? 'Portal masuk untuk karyawan, mitra, dan pihak lain yang berkepentingan dengan sistem internal Madael Consult.'
            : 'Login portal for employees, partners, and other authorized parties of Madael Consult\u2019s internal system.'}
        </p>

        {resetSuccess && (
          <p className="text-sm text-green-600 text-center mb-4">
            {lang === 'id'
              ? 'Password berhasil diubah. Silakan login dengan password baru kamu.'
              : 'Password changed successfully. Please log in with your new password.'}
          </p>
        )}

        {activatedSuccess && (
          <p className="text-sm text-green-600 text-center mb-4">
            {lang === 'id'
              ? 'Akun berhasil diaktifkan. Silakan login dengan password baru kamu.'
              : 'Account activated successfully. Please log in with your new password.'}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className={labelClass}>Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="password" className={labelClass}>Password</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} pr-11 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={
                  showPassword
                    ? lang === 'id' ? 'Sembunyikan password' : 'Hide password'
                    : lang === 'id' ? 'Tampilkan password' : 'Show password'
                }
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-[#8A8A8A] hover:text-madael-red transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <Link
              href="/employee/forgot-password"
              className="block mt-1.5 text-xs text-[#6B6B6B] hover:text-madael-red transition-colors"
            >
              {lang === 'id' ? 'Lupa password?' : 'Forgot password?'}
            </Link>
          </div>

          {error && <p className="text-sm text-madael-red">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? lang === 'id' ? 'Memproses...' : 'Processing...' : lang === 'id' ? 'Masuk' : 'Login'}
          </button>
        </form>
      </div>
    </section>
  );
}

export default function EmployeeLoginPage() {
  return (
    <Suspense fallback={null}>
      <EmployeeLoginForm />
    </Suspense>
  );
}