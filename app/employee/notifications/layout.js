'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import EmployeeHeader from '@/components/EmployeeHeader';

// Pusat Notifikasi tidak butuh modul khusus — setiap karyawan hanya melihat
// notifikasinya sendiri (difilter per user_id di page.js, dan sesi dijaga
// middleware untuk semua path /employee), jadi layout ini tidak memakai
// useModuleAccess.
export default function NotificationsLayout({ children }) {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/employee/login');
    router.refresh();
  };

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
