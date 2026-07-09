'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/context/LanguageContext';

export default function Navbar() {
  const pathname = usePathname();
  const { lang, toggleLang } = useLanguage();
  const isHome = pathname === '/';
  const isAbout = pathname === '/about';
  const isKalkulator = pathname === '/kalkulator-pph21';
  const contactHref = isAbout ? '/about#contact' : '/#contact';
  

  return (
    <nav className="flex items-center justify-between px-10 h-[68px] border-b border-[#E0E0E0] bg-white sticky top-0 z-[999]">
      <Link href="/" className="flex items-center gap-2.5 no-underline">
        <Image
          src="/logos/madael_logo_transparent.png"
          alt="Madael Consult"
          width={32}
          height={32}
          className="object-contain"
        />
        <span className="text-[15px] font-semibold text-black tracking-[-0.01em]">
          Madael Consult
        </span>
      </Link>

      <ul className="flex items-center gap-8 list-none">
        <li>
          <Link
            href="/"
            className={`text-sm tracking-[0.02em] no-underline transition-colors ${
              isHome ? 'text-black' : 'text-[#6B6B6B] hover:text-black'
            }`}
          >
            Home
          </Link>
        </li>
                <li>
          <Link
            href="/about"
            className={`text-sm tracking-[0.02em] no-underline transition-colors ${
              isAbout ? 'text-black' : 'text-[#6B6B6B] hover:text-black'
            }`}
          >
            About
          </Link>
        </li>
        <li>
          <Link
            href="/kalkulator-pph21"
            className={`text-sm tracking-[0.02em] no-underline transition-colors ${
              isKalkulator ? 'text-black' : 'text-[#6B6B6B] hover:text-black'
            }`}
          >
            Kalkulator PPh 21
          </Link>
        </li>
        <li>
          <Link
            href={contactHref}
            className="bg-madael-red text-white px-5 py-2 text-[13px] font-medium tracking-[0.04em] no-underline hover:bg-madael-dark transition-colors"
          >
            {lang === 'id' ? 'Hubungi Kami' : 'Contact Us'}
          </Link>
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
