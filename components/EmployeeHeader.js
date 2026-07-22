'use client';

import NotificationBell from '@/components/NotificationBell';

// Header bersama untuk semua halaman/layout di area /employee — sebelumnya
// setiap layout re-implement header ini sendiri-sendiri (10+ salinan hampir
// identik). Sekarang cukup satu tempat, dan NotificationBell otomatis ada
// di semua halaman yang pakai komponen ini.
//
// `left`      : konten kiri (back-link + tab-tab modul), beda-beda per modul
// `onLogout`  : handler tombol logout, tetap di-pass dari tiap layout karena
//               tiap layout sudah punya instance `supabase`/`router` sendiri
// `printHidden`: true untuk halaman yang punya mode print (documents, list,
//               crm, statistics, payslip) — ikut pola print:hidden yang sudah ada
export default function EmployeeHeader({ left, onLogout, printHidden = false }) {
  return (
    <div
      className={`${printHidden ? 'print:hidden ' : ''}flex items-center justify-between px-10 h-[68px] border-b border-[#E0E0E0] bg-white sticky top-0 z-[999]`}
    >
      <div className="flex items-center gap-8">{left}</div>
      <div className="flex items-center gap-1">
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
  );
}
