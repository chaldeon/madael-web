'use client';

import { usePathname } from 'next/navigation';
import Navbar from './Navbar';
import Footer from './Footer';
import WAButton from './WAButton';

export default function SiteChrome({ children }) {
  const pathname = usePathname();
  const isAdminArea = pathname.startsWith('/admin') || pathname.startsWith('/login');

  if (isAdminArea) {
    // /admin/* punya AdminNav sendiri lewat app/admin/layout.js
    // /login sengaja polos, tanpa navbar publik maupun admin
    return <>{children}</>;
  }

  return (
    <>
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
      <WAButton />
    </>
  );
}