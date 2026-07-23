'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import EmployeeHeader from '@/components/EmployeeHeader';

export default function AbsensiLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { status, employee, hasModule } = useModuleAccess(['absensi', 'absensi_jadwal']);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/employee/login');
    router.refresh();
  };

  if (status === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
      </section>
    );
  }

  if (status === 'denied') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Kamu tidak punya akses ke halaman Absensi.</p>
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

  const isJadwal = pathname.startsWith('/employee/absensi/jadwal');
  const isRekap = pathname.startsWith('/employee/absensi/rekap');
  const isKoreksi = pathname.startsWith('/employee/absensi/koreksi');
  const isAbsensi = !isJadwal && !isRekap && !isKoreksi;
  const tabClass = (active) =>
    `text-sm tracking-[0.02em] transition-colors ${
      active ? 'text-black font-medium' : 'text-[#6B6B6B] hover:text-black'
    }`;

  return (
    <section className="min-h-screen bg-[#F4F4F4]">
      <EmployeeHeader
        onLogout={handleLogout}
        left={
          <>
            <Link href="/employee/dashboard" className="text-sm text-[#6B6B6B] hover:text-black">
              ← Dashboard
            </Link>
            <div className="flex items-center gap-6">
              {hasModule('absensi') && (
                <Link href="/employee/absensi" className={tabClass(isAbsensi)}>
                  Absensi
                </Link>
              )}
              {hasModule('absensi_jadwal') && (
                <Link href="/employee/absensi/jadwal" className={tabClass(isJadwal)}>
                  Jadwal Kerja
                </Link>
              )}
              {employee?.is_superadmin && (
                <Link href="/employee/absensi/rekap" className={tabClass(isRekap)}>
                  Rekap Bulanan
                </Link>
              )}
              {employee?.is_superadmin && (
                <Link href="/employee/absensi/koreksi" className={tabClass(isKoreksi)}>
                  Koreksi
                </Link>
              )}
            </div>
          </>
        }
      />

      {children}
    </section>
  );
}