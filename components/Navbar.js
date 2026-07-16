'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export default function Navbar() {
  const pathname = usePathname();
  const { lang, toggleLang } = useLanguage();
  const isHome = pathname === '/';
  const isAbout = pathname === '/about';
  const SHOW_KARIR = false;
  const SHOW_EMPLOYEE = false;
  const toolLinks = [
    { href: '/kalkulator-pph21', label: 'Kalkulator PPh 21' },
    { href: '/kalkulator-bpjs', label: 'Kalkulator BPJS' },
    { href: '/kalkulator-lembur', label: 'Kalkulator Lembur' },
    { href: '/kalkulator-pkwt', label: 'Kalkulator PKWT' },
    { href: '/kalkulator-pesangon', label: 'Kalkulator Pesangon' },
  ];
  const isToolsActive = toolLinks.some((t) => t.href === pathname);
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

        {SHOW_KARIR && (
          <li>
            <Link
              href="/karir"
              className={`text-sm tracking-[0.02em] no-underline transition-colors ${
                pathname === '/karir' ? 'text-black' : 'text-[#6B6B6B] hover:text-black'
              }`}
            >
              {lang === 'id' ? 'Karir' : 'Careers'}
            </Link>
          </li>
        )}

        {/* Dropdown "Alat" — hover trigger */}
        <li className="relative group">
          <button
            type="button"
            className={`flex items-center gap-1 text-sm tracking-[0.02em] bg-transparent border-0 cursor-pointer transition-colors ${
              isToolsActive ? 'text-black' : 'text-[#6B6B6B] hover:text-black'
            }`}
          >
            {lang === 'id' ? 'Alat' : 'Tools'}
            <ChevronDown
              size={14}
              className="transition-transform duration-150 group-hover:rotate-180"
            />
          </button>

          {/* bridge biar hover gak putus pas geser mouse ke bawah */}
          <div className="absolute left-0 top-full pt-3 invisible opacity-0 translate-y-1 group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150 z-[1000]">
            <ul className="bg-white border border-[#E0E0E0] shadow-lg min-w-[230px] py-2 list-none">
              {toolLinks.map((t) => (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    className={`block px-4 py-2.5 text-sm no-underline transition-colors ${
                      pathname === t.href
                        ? 'text-madael-red bg-[#FAFAFA]'
                        : 'text-[#6B6B6B] hover:text-black hover:bg-[#FAFAFA]'
                    }`}
                  >
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
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
        <li className="w-0.5 h-5 bg-[#E0E0E0] mr-1" aria-hidden="true" />

        {SHOW_EMPLOYEE && (
          <>
            <li className="w-0.5 h-5 bg-[#E0E0E0] mr-1" aria-hidden="true" />
            <li>
              <Link
                href="/employee/login"
                className={`text-sm tracking-[0.02em] no-underline transition-colors ${
                  pathname.startsWith('/employee') ? 'text-black' : 'text-[#6B6B6B] hover:text-black'
                }`}
              >
                Employee
              </Link>
            </li>
          </>
        )}
      </ul>
    </nav>
  );
}