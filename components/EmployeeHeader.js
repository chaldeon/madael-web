'use client';

import Link from 'next/link';
import Image from 'next/image';
import NotificationBell from '@/components/NotificationBell';

// Header bersama untuk semua halaman/layout di area /employee — sebelumnya
// setiap layout re-implement header ini sendiri-sendiri (10+ salinan hampir
// identik). Sekarang cukup satu tempat, dan NotificationBell otomatis ada
// di semua halaman yang pakai komponen ini.
//
// `left`      : konten kecil di baris utama, sebelah logo (mis. nama +
//               perusahaan di Dashboard). Bukan untuk back-link/tab — pakai
//               `subnav` untuk itu.
// `subnav`    : back-link ke Dashboard + tab-tab modul (Absensi Saya / Semua
//               Karyawan, dsb). Dirender di baris terpisah di bawah header
//               utama, bukan dijejalkan sebelah logo — sebelumnya numpuk
//               jadi 2 baris sempit dan kelihatan berantakan.
// `onLogout`  : handler tombol logout, tetap di-pass dari tiap layout karena
//               tiap layout sudah punya instance `supabase`/`router` sendiri
// `printHidden`: true untuk halaman yang punya mode print (documents, list,
//               crm, statistics, payslip) — ikut pola print:hidden yang sudah ada
export default function EmployeeHeader({ left, subnav, search, onLogout, printHidden = false }) {
  return (
    <div className={`${printHidden ? 'print:hidden ' : ''}sticky top-0 z-[999] bg-white`}>
      {/* Baris utama: logo (jalan balik ke website publik) + info ringkas + notif/logout */}
      <div className="flex items-center justify-between gap-4 px-4 sm:px-6 lg:px-10 h-[68px] border-b border-[#E0E0E0]">
        <div className="flex items-center gap-4 sm:gap-6 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-2 shrink-0 no-underline"
            title="Kembali ke website Madael Consult"
          >
            <Image
              src="/logos/madael_logo_transparent.png"
              alt="Madael Consult"
              width={28}
              height={28}
              className="object-contain"
            />
            <span className="hidden sm:inline text-[13px] font-semibold text-black tracking-[-0.01em] whitespace-nowrap">
              Madael Consult
            </span>
          </Link>

          {left && (
            <>
              <span className="w-px h-6 bg-[#E0E0E0] shrink-0" aria-hidden="true" />
              <div className="min-w-0 overflow-hidden">{left}</div>
            </>
          )}
        </div>

        {search && <div className="flex-1 flex justify-center px-6">{search}</div>}

        <div className="flex items-center gap-1 shrink-0">
          <NotificationBell />
          <button
            type="button"
            onClick={onLogout}
            className="ml-3 bg-madael-red text-white px-5 py-2 text-[13px] font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors cursor-pointer border-0"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Baris sub-navigasi: back-link + tab modul, terpisah dari baris utama */}
      {subnav && (
        <div className="flex items-center gap-6 px-4 sm:px-6 lg:px-10 h-11 border-b border-[#E0E0E0] bg-[#FAFAFA] overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {subnav}
        </div>
      )}
    </div>
  );
}
