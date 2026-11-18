'use client';

import Link from 'next/link';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';

// Guard bersarang untuk semua halaman di bawah /employee/payroll/bpa1.
// app/employee/payroll/layout.js (induk) tetap jadi gate 'payroll' + header + tab
// dan TIDAK diubah perilakunya: layout ini hanya menambah syarat 'bpa1' khusus
// subtree BPA1, jadi halaman Payroll lain tidak terpengaruh. Penjaga sebenarnya
// tetap server (requireBpa1Access di lib/moduleAccessServer.js); layout ini cuma
// menyembunyikan halaman dari akun yang tidak berhak.
export default function Bpa1Layout({ children }) {
  const { status } = useModuleAccess('bpa1');

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingState label="Memuat..." />
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className="flex items-center justify-center px-6 py-24">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Kamu tidak punya akses ke modul BPA1.</p>
          <Link
            href="/employee/payroll"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali ke Payroll
          </Link>
        </div>
      </div>
    );
  }

  return children;
}
