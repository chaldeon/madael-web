'use client';

import { usePathname } from 'next/navigation';
import Navbar from './Navbar';
import Footer from './Footer';
import WAButton from './WAButton';

export default function SiteChrome({ children }) {
  const pathname = usePathname();
  // Halaman /employee/* (selain /employee/login) sudah punya header sendiri
  // (EmployeeHeader.js — test/Logout/bell), jadi navbar publik tidak perlu
  // ikut nongol di situ. Sebelumnya dua-duanya sticky top-0 z-999 dan
  // numpuk/overlap satu sama lain begitu user login.
  const isEmployeeApp = pathname.startsWith('/employee') && pathname !== '/employee/login';

  return (
    <>
      {!isEmployeeApp && <Navbar />}
      <main className="flex-1">{children}</main>
      <Footer />
      {/* Tombol konsultasi WhatsApp hanya untuk pengunjung publik; di area
          employee posisinya dipakai bubble feedback (FeedbackBubble). */}
      {!isEmployeeApp && <WAButton />}
    </>
  );
}