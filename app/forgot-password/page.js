'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

// Portal asal dipakai untuk: (1) tombol "kembali ke login" arahnya benar,
// (2) redirectTo di reset-password bawa info portal, supaya setelah set
// password baru user diarahkan balik ke login yang sesuai (admin/employee).
export default function ForgotPasswordPage() {
  const searchParams = useSearchParams();
  const portal = searchParams.get('portal') === 'admin' ? 'admin' : 'employee';
  const loginPath = portal === 'admin' ? '/login' : '/employee/login';

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const inputClass =
    'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/reset-password?portal=${portal}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    setLoading(false);
    if (error) {
      setError(error.message || 'Gagal mengirim email reset password.');
      return;
    }
    // Selalu tampilkan pesan sukses walau email tidak terdaftar,
    // supaya tidak bocorkan info email mana yang punya akun (email enumeration).
    setSent(true);
  };

  return (
    <section className="min-h-[calc(100vh-68px)] flex items-center justify-center bg-black px-6">
      <div className="w-full max-w-[380px] border-t-4 border-madael-red bg-white p-8">
        <h1 className="font-serif text-[24px] font-normal text-black tracking-[-0.02em] mb-1">
          Lupa Password
        </h1>
        <p className="text-sm text-[#6B6B6B] mb-6">
          Masukkan email akun Anda, kami akan kirim link untuk mengatur password baru.
        </p>

        {sent ? (
          <div className="space-y-5">
            <p className="text-sm text-black bg-[#F4F4F4] border border-[#E0E0E0] px-4 py-3">
              Kalau email <span className="font-medium">{email}</span> terdaftar, link reset password sudah dikirim. Cek inbox (dan folder spam) beberapa menit ke depan.
            </p>
            <Link
              href={loginPath}
              className="block text-center w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
            >
              Kembali ke Login
            </Link>
          </div>
        ) : (
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
              {loading ? 'Mengirim...' : 'Kirim Link Reset'}
            </button>

            <Link
              href={loginPath}
              className="block text-center text-xs text-[#6B6B6B] hover:text-madael-red"
            >
              Kembali ke Login
            </Link>
          </form>
        )}
      </div>
    </section>
  );
}