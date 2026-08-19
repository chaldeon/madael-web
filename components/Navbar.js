'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu, X } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export default function Navbar() {
  const pathname = usePathname();
  const { lang, toggleLang } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const isHome = pathname === '/';
  const isAbout = pathname === '/about';
  const SHOW_KARIR = true;
  const SHOW_EMPLOYEE = true;
  const toolLinks = [
    { href: '/kalkulator-pph21', label: 'Kalkulator PPh 21' },
    { href: '/kalkulator-bpjs', label: 'Kalkulator BPJS' },
    { href: '/kalkulator-lembur', label: 'Kalkulator Lembur' },
    { href: '/kalkulator-pkwt', label: 'Kalkulator PKWT' },
    { href: '/kalkulator-pesangon', label: 'Kalkulator Pesangon' },
  ];
  const isToolsActive = toolLinks.some((t) => t.href === pathname);
  const contactHref = isAbout ? '/about#contact' : '/#contact';

  const closeAll = () => {
    setMobileOpen(false);
    setToolsOpen(false);
  };

  return (
    <nav className="print:hidden relative flex items-center justify-between px-4 sm:px-6 lg:px-10 h-[68px] border-b border-[#E0E0E0] bg-white sticky top-0 z-[999]">
      <Link href="/" className="flex items-center gap-2.5 no-underline shrink-0" onClick={closeAll}>
        <Image
          src="/logos/madael_logo_transparent.png"
          alt="Madael Consult"
          width={32}
          height={32}
          className="object-contain"
        />
        <span className="text-[15px] font-semibold text-black tracking-[-0.01em] whitespace-nowrap">
          Madael Consult
        </span>
      </Link>

      {/* ===== Desktop nav (>= lg) ===== */}
      <ul className="hidden lg:flex items-center gap-8 list-none">
        <li>
          <Link
            href="/"
            className={`text-sm tracking-[0.02em] no-underline transition-colors ${
              isHome ? 'text-black' : 'text-[#6B6B6B] hover:text-black'
            }`}
          >
            {lang === 'id' ? 'Beranda' : 'Home'}
          </Link>
        </li>
        <li>
          <Link
            href="/about"
            className={`text-sm tracking-[0.02em] no-underline transition-colors ${
              isAbout ? 'text-black' : 'text-[#6B6B6B] hover:text-black'
            }`}
          >
            {lang === 'id' ? 'Tentang Kami ' : 'About Us'}
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
            className="bg-madael-red text-white px-5 py-2 text-[13px] font-medium tracking-[0.04em] no-underline hover:bg-madael-dark transition-colors whitespace-nowrap"
          >
            {lang === 'id' ? 'Hubungi Kami' : 'Contact Us'}
          </Link>
        </li>
        <li className="w-0.5 h-5 bg-[#E0E0E0] mr-1" aria-hidden="true" />
        <li className="flex border border-[#E0E0E0]">
          <button
            onClick={() => lang !== 'id' && toggleLang()}
            className={`px-3 py-1.5 text-xs font-semibold tracking-[0.04em] cursor-pointer transition-colors ${
              lang === 'id'
                ? 'bg-madael-red text-white'
                : 'bg-transparent text-[#6B6B6B] hover:text-black'
            }`}
          >
            ID
          </button>
          <button
            onClick={() => lang !== 'en' && toggleLang()}
            className={`px-3 py-1.5 text-xs font-semibold tracking-[0.04em] cursor-pointer transition-colors border-l border-[#E0E0E0] ${
              lang === 'en'
                ? 'bg-madael-red text-white'
                : 'bg-transparent text-[#6B6B6B] hover:text-black'
            }`}
          >
            EN
          </button>
        </li>

        {SHOW_EMPLOYEE && (
          <>
            <li className="w-0.5 h-5 bg-[#E0E0E0] mr-1" aria-hidden="true" />
            <li>
              <Link
                href="/employee/login"
                className={`border px-5 py-2 text-[13px] font-medium tracking-[0.04em] no-underline transition-colors whitespace-nowrap ${
                  pathname.startsWith('/employee')
                    ? 'border-madael-red text-madael-red'
                    : 'border-[#E0E0E0] text-black hover:border-madael-red hover:text-madael-red'
                }`}
              >
                {lang === 'id' ? 'Masuk' : 'Login'}
              </Link>
            </li>
          </>
        )}
      </ul>

      {/* ===== Mobile hamburger button (< lg) ===== */}
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        className="lg:hidden p-2 -mr-2 text-black cursor-pointer bg-transparent border-0"
        aria-label={mobileOpen ? 'Tutup menu' : 'Buka menu'}
        aria-expanded={mobileOpen}
      >
        {mobileOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      {/* ===== Mobile menu panel (< lg) ===== */}
      {mobileOpen && (
        <div className="lg:hidden absolute top-full left-0 right-0 max-h-[calc(100vh-68px)] overflow-y-auto bg-white border-b border-[#E0E0E0] shadow-lg z-[1000]">
          <ul className="flex flex-col list-none py-2">
            <li>
              <Link
                href="/"
                onClick={closeAll}
                className={`block px-6 py-3 text-sm no-underline transition-colors ${
                  isHome ? 'text-black bg-[#FAFAFA]' : 'text-[#6B6B6B]'
                }`}
              >
                {lang === 'id' ? 'Beranda' : 'Home'}
              </Link>
            </li>
            <li>
              <Link
                href="/about"
                onClick={closeAll}
                className={`block px-6 py-3 text-sm no-underline transition-colors ${
                  isAbout ? 'text-black bg-[#FAFAFA]' : 'text-[#6B6B6B]'
                }`}
              >
                {lang === 'id' ? 'Tentang Kami' : 'About Us'}
              </Link>
            </li>

            {SHOW_KARIR && (
              <li>
                <Link
                  href="/karir"
                  onClick={closeAll}
                  className={`block px-6 py-3 text-sm no-underline transition-colors ${
                    pathname === '/karir' ? 'text-black bg-[#FAFAFA]' : 'text-[#6B6B6B]'
                  }`}
                >
                  {lang === 'id' ? 'Karir' : 'Careers'}
                </Link>
              </li>
            )}

            <li>
              <button
                type="button"
                onClick={() => setToolsOpen((v) => !v)}
                className={`flex items-center justify-between w-full px-6 py-3 text-sm bg-transparent border-0 cursor-pointer transition-colors ${
                  isToolsActive ? 'text-black' : 'text-[#6B6B6B]'
                }`}
              >
                {lang === 'id' ? 'Alat' : 'Tools'}
                <ChevronDown
                  size={14}
                  className={`transition-transform duration-150 ${toolsOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {toolsOpen && (
                <ul className="bg-[#FAFAFA] list-none">
                  {toolLinks.map((t) => (
                    <li key={t.href}>
                      <Link
                        href={t.href}
                        onClick={closeAll}
                        className={`block px-10 py-2.5 text-sm no-underline transition-colors ${
                          pathname === t.href ? 'text-madael-red' : 'text-[#6B6B6B]'
                        }`}
                      >
                        {t.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>

            <li className="px-6 pt-3 pb-2">
              <Link
                href={contactHref}
                onClick={closeAll}
                className="block text-center bg-madael-red text-white px-5 py-2.5 text-[13px] font-medium tracking-[0.04em] no-underline hover:bg-madael-dark transition-colors"
              >
                {lang === 'id' ? 'Hubungi Kami' : 'Contact Us'}
              </Link>
            </li>

            <li className="px-6 py-3 flex items-center gap-3">
              <div className="flex border border-[#E0E0E0] shrink-0">
                <button
                  onClick={() => lang !== 'id' && toggleLang()}
                  className={`px-3 py-1.5 text-xs font-semibold tracking-[0.04em] cursor-pointer transition-colors ${
                    lang === 'id'
                      ? 'bg-madael-red text-white'
                      : 'bg-transparent text-[#6B6B6B]'
                  }`}
                >
                  ID
                </button>
                <button
                  onClick={() => lang !== 'en' && toggleLang()}
                  className={`px-3 py-1.5 text-xs font-semibold tracking-[0.04em] cursor-pointer transition-colors border-l border-[#E0E0E0] ${
                    lang === 'en'
                      ? 'bg-madael-red text-white'
                      : 'bg-transparent text-[#6B6B6B]'
                  }`}
                >
                  EN
                </button>
              </div>

              {SHOW_EMPLOYEE && (
                <Link
                  href="/employee/login"
                  onClick={closeAll}
                  className={`flex-1 text-center border px-5 py-2 text-[13px] font-medium tracking-[0.04em] no-underline transition-colors ${
                    pathname.startsWith('/employee')
                      ? 'border-madael-red text-madael-red'
                      : 'border-[#E0E0E0] text-black'
                  }`}
                >
                  {lang === 'id' ? 'Masuk' : 'Login'}
                </Link>
              )}
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
}