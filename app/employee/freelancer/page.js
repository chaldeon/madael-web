'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import EmployeeHeader from '@/components/EmployeeHeader';
import LoadingState from '@/components/LoadingState';
import { friendlyError } from '@/lib/errorMessage';
import {
  FREELANCER_MODULE_REGISTRY,
  isFreelancerModuleGranted,
} from '@/lib/freelancerModules';

// Dashboard Freelancer. Login-nya sama dengan karyawan (/employee/login); akun
// yang tidak punya baris di `employees` tapi punya baris di `freelancers`
// diarahkan ke sini oleh /employee/dashboard.
//
// Hanya kolom non-sensitif yang dibaca dari browser (izin SELECT kolom
// rekening/NPWP/NIK memang tidak diberikan ke role authenticated), dan RLS
// membatasi hasilnya ke baris milik akun yang login.
export default function FreelancerDashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [freelancer, setFreelancer] = useState(null);
  const [moduleKeys, setModuleKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/employee/login');
      return;
    }

    const { data: fl, error: flError } = await supabase
      .from('freelancers')
      .select('id, freelancer_code, nama_lengkap, status')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (flError) {
      setError(friendlyError(flError, 'Data akun gagal dimuat.', { context: 'Muat dashboard Freelancer' }));
      setLoading(false);
      return;
    }

    // Bukan akun Freelancer (mis. karyawan yang membuka URL ini): kembali ke
    // dashboard karyawan, yang menampilkan pesan bila akunnya juga tidak dikenal.
    if (!fl) {
      router.replace('/employee/dashboard');
      return;
    }

    setFreelancer(fl);

    if (fl.status === 'active') {
      const { data: mods, error: modsError } = await supabase
        .from('freelancer_modules')
        .select('module_name')
        .eq('freelancer_id', fl.id);
      if (modsError) {
        setError(friendlyError(modsError, 'Daftar modul gagal dimuat.', { context: 'Muat modul Freelancer' }));
        setLoading(false);
        return;
      }
      setModuleKeys((mods || []).map((m) => m.module_name));
    }

    setLoading(false);
  }, [supabase, router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/employee/login');
    router.refresh();
  };

  if (loading) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat..." />
      </section>
    );
  }

  if (error) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">{error}</p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => {
                setLoading(true);
                setError(null);
                loadData();
              }}
              className="border border-madael-red text-madael-red px-6 py-2.5 text-sm font-medium hover:bg-madael-red hover:text-white transition-colors"
            >
              Coba Lagi
            </button>
            <button
              onClick={handleLogout}
              className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </section>
    );
  }

  const isActive = freelancer.status === 'active';
  const hasAccess = (key) =>
    isFreelancerModuleGranted({ status: freelancer.status, moduleKeys, key });
  const visibleModules = FREELANCER_MODULE_REGISTRY.filter((mod) => hasAccess(mod.key));

  return (
    <section className="min-h-screen bg-[#F4F4F4]">
      <EmployeeHeader
        onLogout={handleLogout}
        left={
          <div>
            <p className="text-sm font-semibold text-black">{freelancer.nama_lengkap}</p>
            <p className="text-xs text-[#6B6B6B]">Freelancer · {freelancer.freelancer_code}</p>
          </div>
        }
      />

      <div className="max-w-[1100px] mx-auto px-6 py-10">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-1">
          Dashboard Freelancer
        </h1>
        <p className="text-sm text-[#6B6B6B] mb-8">Selamat datang, {freelancer.nama_lengkap}.</p>

        {!isActive ? (
          <div className="border-l-4 border-madael-red bg-white p-4">
            <p className="text-sm text-black">
              Akun Freelancer kamu sedang tidak aktif, jadi fitur dashboard belum bisa dipakai.
              Hubungi tim Madael untuk informasi lebih lanjut.
            </p>
          </div>
        ) : visibleModules.length === 0 ? (
          <div className="border-l-4 border-[#C9C9C9] bg-white p-4">
            <p className="text-sm text-[#6B6B6B]">
              Belum ada fitur yang tersedia untuk akun kamu. Hubungi tim Madael bila ini tidak sesuai.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleModules.map((mod) => {
              const Icon = mod.icon;
              const isLive = mod.status === 'live';
              const CardTag = isLive ? Link : 'div';
              const cardProps = isLive ? { href: mod.href } : {};

              return (
                <CardTag
                  key={mod.key}
                  {...cardProps}
                  className={`block border p-5 transition-colors ${
                    isLive
                      ? 'bg-white border-[#E0E0E0] hover:border-madael-red cursor-pointer'
                      : 'bg-[#FAFAFA] border-[#E0E0E0] cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div
                      className={`w-10 h-10 flex items-center justify-center ${
                        isLive ? 'bg-madael-red text-white' : 'bg-[#E0E0E0] text-[#9A9A9A]'
                      }`}
                    >
                      <Icon size={18} />
                    </div>
                    {!isLive ? (
                      <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-[#E0E0E0] text-[#6B6B6B]">
                        COMING SOON
                      </span>
                    ) : null}
                  </div>
                  <p className={`text-sm font-medium mb-1 ${isLive ? 'text-black' : 'text-[#9A9A9A]'}`}>
                    {mod.name}
                  </p>
                  <p className="text-xs text-[#6B6B6B]">{mod.desc}</p>
                </CardTag>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
