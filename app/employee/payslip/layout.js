'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';

export default function PayslipLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { status, hasModule } = useModuleAccess(['payslip', 'payslip_admin']);

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
          <p className="text-sm text-black mb-6">Kamu tidak punya akses ke modul Payslip.</p>
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

  const isAdmin = pathname.startsWith('/employee/payslip/admin');
  const tabClass = (active) =>
    `text-sm tracking-[0.02em] transition-colors ${
      active ? 'text-black font-medium' : 'text-[#6B6B6B] hover:text-black'
    }`;

  return (
    <section className="min-h-screen bg-[#F4F4F4]">
      <div className="print:hidden flex items-center justify-between px-10 h-[68px] border-b border-[#E0E0E0] bg-white sticky top-0 z-[999]">
        <div className="flex items-center gap-8">
          <Link href="/employee/dashboard" className="text-sm text-[#6B6B6B] hover:text-black">
            ← Dashboard
          </Link>
          <div className="flex items-center gap-6">
            {hasModule('payslip') && (
              <Link href="/employee/payslip" className={tabClass(!isAdmin)}>
                Slip Gaji Saya
              </Link>
            )}
            {hasModule('payslip_admin') && (
              <Link href="/employee/payslip/admin" className={tabClass(isAdmin)}>
                Kelola Slip Gaji
              </Link>
            )}
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="bg-madael-red text-white px-5 py-2 text-[13px] font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors cursor-pointer border-0"
        >
          Logout
        </button>
      </div>

      {children}
    </section>
  );
}