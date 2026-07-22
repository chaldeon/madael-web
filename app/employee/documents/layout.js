'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';
import EmployeeHeader from '@/components/EmployeeHeader';

export default function DocumentsLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { status, employee, hasModule } = useModuleAccess(['document_generator', 'nomor_surat']);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/employee/login');
    router.refresh();
  };

  if (status === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat..." />
      </section>
    );
  }

  if (status === 'denied') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Kamu tidak punya akses ke modul Document Generator.</p>
          <Link
            href="/employee/dashboard"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali ke Dashboard
          </Link>
        </div>
      </section>
    );
  }

  const isNomorSurat = pathname.startsWith('/employee/documents/nomor-surat');
  const isInvoices = pathname.startsWith('/employee/documents/invoices');
  const tabClass = (active) =>
    `text-sm tracking-[0.02em] transition-colors ${
      active ? 'text-black font-medium' : 'text-[#6B6B6B] hover:text-black'
    }`;

  return (
    <section className="min-h-screen bg-[#F4F4F4]">
      <EmployeeHeader
        printHidden
        onLogout={handleLogout}
        left={
          <>
            <Link href="/employee/dashboard" className="text-sm text-[#6B6B6B] hover:text-black">
              ← Dashboard
            </Link>
            <div className="flex items-center gap-6">
              {hasModule('document_generator') && (
                <Link href="/employee/documents" className={tabClass(!isNomorSurat && !isInvoices)}>
                  Documents
                </Link>
              )}
              {hasModule('nomor_surat') && (
                <Link href="/employee/documents/nomor-surat" className={tabClass(isNomorSurat)}>
                  Nomor Surat
                </Link>
              )}
              {employee?.is_superadmin && (
                <Link href="/employee/documents/invoices" className={tabClass(isInvoices)}>
                  Invoice
                </Link>
              )}
            </div>
          </>
        }
      />

      {children}
    </section>
  );
}