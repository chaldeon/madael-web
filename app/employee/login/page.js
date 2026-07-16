'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase-browser';

export default function EmployeeLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        router.push('/employee/dashboard');
        return;
      }
      setCheckingSession(false);
    };
    checkSession();
  }, [router]);

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
      setError('Email atau password salah.');
      setLoading(false);
      return;
    }

    router.push('/employee/dashboard');
    router.refresh();
  };

  if (checkingSession) {
    return (
      <section className="min-h-[calc(100vh-68px)] flex items-center justify-center bg-black">
        <p className="text-sm text-white/60">Memuat...</p>
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
          Employee Login
        </h1>
        <p className="text-sm text-[#6B6B6B] mb-6 text-center">Madael Consult</p>

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
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          {error && <p className="text-sm text-madael-red">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Memproses...' : 'Login'}
          </button>
        </form>
      </div>
    </section>
  );
}