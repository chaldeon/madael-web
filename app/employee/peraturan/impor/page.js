'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { PERATURAN_MODULE_KEY } from '@/lib/peraturanConfig';
import LoadingState from '@/components/LoadingState';
import PeraturanImport from '@/components/peraturan/PeraturanImport';

export default function ImporPeraturanPage() {
  const { employee } = useModuleAccess(PERATURAN_MODULE_KEY);

  if (!employee) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-10">
        <LoadingState label="Memuat..." />
      </div>
    );
  }

  // Hak tulis = superadmin. Ini cuma menyembunyikan halaman; RLS yang menolak
  // insert dari akun lain.
  if (!employee.is_superadmin) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-10">
        <div className="border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Hanya superadmin yang dapat mengimpor peraturan.</p>
          <Link href="/employee/peraturan" className="text-sm text-madael-red hover:text-madael-dark">
            ← Kembali ke daftar
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-10">
      <Link
        href="/employee/peraturan"
        className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-black mb-6"
      >
        <ArrowLeft size={14} />
        Kembali ke daftar
      </Link>
      <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-6">Impor Peraturan</h1>
      <PeraturanImport employee={employee} />
    </div>
  );
}
