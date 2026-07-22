'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';
import EmployeeHeader from '@/components/EmployeeHeader';

export default function PayrollLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { status } = useModuleAccess('payroll');

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
          <p className="text-sm text-black mb-6">Halaman ini khusus untuk superadmin.</p>
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

  const isRun = pathname.startsWith('/employee/payroll/run');
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
              <Link href="/employee/payroll" className={tabClass(!isRun)}>
                Employee Master
              </Link>
              <Link href="/employee/payroll/run" className={tabClass(isRun)}>
                Payroll Run
              </Link>
            </div>
          </>
        }
      />

      {children}
    </section>
  );
}