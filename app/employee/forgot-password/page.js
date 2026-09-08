'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createClient } from '@/lib/supabase-browser';
import { useLanguage } from '@/context/LanguageContext';

export default function EmployeeForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { lang } = useLanguage();

  const inputClass =
    'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();

    // redirectTo WAJIB terdaftar di Supabase Dashboard:
    // Authentication > URL Configuration > Redirect URLs
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/employee/reset-password`,
    });

    setLoading(false);

    // Selalu tampilkan pesan sukses walau email tidak terdaftar,
    // supaya tidak bisa dipakai untuk mengecek email mana yang punya akun (email enumeration).
    if (error) {
      console.error('resetPasswordForEmail error:', error.message);
    }
    setSent(true);
  };

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
          {lang === 'id' ? 'Lupa Password' : 'Forgot Password'}
        </h1>

        {sent ? (
          <>
            <p className="text-sm text-[#3D3D3D] text-center leading-relaxed mb-6">
              {lang === 'id'
                ? 'Kalau email tersebut terdaftar, kami sudah mengirimkan link reset password. Silakan cek inbox (atau folder spam) email kamu.'
                : "If that email is registered, we've sent a password reset link. Please check your inbox (or spam folder)."}
            </p>
            <Link
              href="/employee/login"
              className="block w-full text-center bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
            >
              {lang === 'id' ? 'Kembali ke Login' : 'Back to Login'}
            </Link>
          </>
        ) : (
          <>
            <p className="text-xs text-[#8A8A8A] mb-6 text-center leading-relaxed">
              {lang === 'id'
                ? 'Masukkan email akun karyawan kamu. Kami akan mengirimkan link untuk membuat password baru.'
                : 'Enter your employee account email. We will send you a link to set a new password.'}
            </p>

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

              {error && <p className="text-sm text-madael-red">{error}</p>}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading
                  ? lang === 'id' ? 'Mengirim...' : 'Sending...'
                  : lang === 'id' ? 'Kirim Link Reset' : 'Send Reset Link'}
              </button>

              <Link
                href="/employee/login"
                className="block text-center text-xs text-[#6B6B6B] hover:text-madael-red transition-colors"
              >
                {lang === 'id' ? 'Kembali ke Login' : 'Back to Login'}
              </Link>
            </form>
          </>
        )}
      </div>
    </section>
  );
}