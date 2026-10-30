'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';
import EmployeeHeader from '@/components/EmployeeHeader';

// Layout bersama untuk modul di area /employee. Sebelumnya setiap
// app/employee/<modul>/layout.js menyalin blok yang sama: gate
// useModuleAccess, state loading, kartu "tidak punya akses", handleLogout,
// EmployeeHeader + back-link Dashboard + tab. Sekarang layout per modul cukup
// mendeklarasikan key modul, label, dan tab; perubahan pola (mis. state error
// untuk useModuleAccess) cukup dilakukan di sini.
//
// Props:
//   moduleKeys  : string atau array string untuk useModuleAccess — lolos kalau
//                 superadmin ATAU punya salah satu key.
//   deniedLabel : kelanjutan kalimat kartu denied, mis. "modul Lembur" →
//                 "Kamu tidak punya akses ke modul Lembur."
//   tabs        : [{ href, label, moduleKey?, isActive(pathname) }]
//                 `moduleKey` opsional: tab hanya tampil bila akun punya key itu
//                 (superadmin lolos, kecuali modul explicit-only). Tanpa
//                 `moduleKey` tab selalu tampil. Isi `tabs` kosong/dihilangkan
//                 bila modul tidak punya sub-navigasi.
//   printHidden : diteruskan ke EmployeeHeader untuk modul dengan mode print.
//   children    : halaman modul.

const tabClass = (active) =>
  `text-sm tracking-[0.02em] transition-colors ${
    active ? 'text-black font-medium' : 'text-[#6B6B6B] hover:text-black'
  }`;

export default function ModuleLayout({
  moduleKeys,
  deniedLabel,
  tabs = [],
  printHidden = false,
  children,
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { status, hasModule } = useModuleAccess(moduleKeys);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/employee/login');
    router.refresh();
  };

  if (status === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat..." />
      </section>
    );
  }

  if (status === 'denied') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Kamu tidak punya akses ke {deniedLabel}.</p>
          <Link
            href="/employee/dashboard"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali ke Dashboard
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-[#F4F4F4]">
      <EmployeeHeader
        printHidden={printHidden}
        onLogout={handleLogout}
        subnav={
          <>
            <Link href="/employee/dashboard" className="text-sm text-[#6B6B6B] hover:text-black">
              ← Dashboard
            </Link>
            <div className="flex items-center gap-6">
              {tabs.map((tab) =>
                tab.moduleKey && !hasModule(tab.moduleKey) ? null : (
                  <Link key={tab.href} href={tab.href} className={tabClass(tab.isActive(pathname))}>
                    {tab.label}
                  </Link>
                )
              )}
            </div>
          </>
        }
      />

      {children}
    </section>
  );
}
