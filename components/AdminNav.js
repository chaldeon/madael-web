'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';
import { createClient } from '@/lib/supabase-browser';

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { lang, toggleLang } = useLanguage();
  const supabase = createClient();

  const navLinks = [
    { href: '/admin', label: lang === 'id' ? 'Dashboard' : 'Dashboard' },
    { href: '/admin/lowongan', label: lang === 'id' ? 'Kelola Lowongan' : 'Manage Jobs' },
  ];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <nav className="flex items-center justify-between px-10 h-[68px] border-b border-[#E0E0E0] bg-white sticky top-0 z-[999]">
      <Link href="/admin" className="flex items-center gap-2.5 no-underline">
        <Image
          src="/logos/madael_logo_transparent.png"
          alt="Madael Consult"
          width={32}
          height={32}
          className="object-contain"
        />
        <span className="text-[15px] font-semibold text-black tracking-[-0.01em]">
          Madael Consult <span className="text-[#6B6B6B] font-normal">· Admin</span>
        </span>
      </Link>

      <ul className="flex items-center gap-8 list-none">
        {navLinks.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={`text-sm tracking-[0.02em] no-underline transition-colors ${
                pathname === item.href ? 'text-black' : 'text-[#6B6B6B] hover:text-black'
              }`}
            >
              {item.label}
            </Link>
          </li>
        ))}

        <li>
          <Link
            href="/"
            className="text-sm tracking-[0.02em] no-underline text-[#6B6B6B] hover:text-black transition-colors"
          >
            {lang === 'id' ? 'Kembali ke Website' : 'Back to Website'}
          </Link>
        </li>

        <li>
          <button
            onClick={handleLogout}
            className="bg-madael-red text-white px-5 py-2 text-[13px] font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors cursor-pointer border-0"
          >
            {lang === 'id' ? 'Logout' : 'Log out'}
          </button>
        </li>

        <li className="w-0.5 h-5 bg-[#E0E0E0] mr-1" aria-hidden="true" />
        <li>
          <button
            onClick={toggleLang}
            className="bg-transparent border border-[#E0E0E0] text-[#6B6B6B] text-xs font-semibold tracking-[0.04em] px-3 py-1.5 cursor-pointer hover:border-madael-red hover:text-madael-red transition-all"
          >
            {lang === 'id' ? 'EN' : 'ID'}
          </button>
        </li>
      </ul>
    </nav>
  );
}