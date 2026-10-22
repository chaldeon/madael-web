'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { PENDING_QUEUE_MODULES } from '@/lib/employeeModules';
import LoadingState from '@/components/LoadingState';
import EmployeeHeader from '@/components/EmployeeHeader';

// Inbox Persetujuan terbuka untuk siapa pun yang memegang minimal satu modul
// antrean persetujuan (flag pendingQueue di MODULE_REGISTRY). Data yang tampil
// tetap difilter per modul di server (/api/approvals/inbox), jadi gate ini
// hanya mencegah halaman kosong untuk karyawan tanpa modul approval.
export default function PersetujuanLayout({ children }) {
  const router = useRouter();
  const supabase = createClient();
  const { status } = useModuleAccess(PENDING_QUEUE_MODULES);

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
          <p className="text-sm text-black mb-6">Kamu tidak punya akses ke Inbox Persetujuan.</p>
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
        onLogout={handleLogout}
        subnav={
          <Link href="/employee/dashboard" className="text-sm text-[#6B6B6B] hover:text-black">
            ← Dashboard
          </Link>
        }
      />

      {children}
    </section>
  );
}
