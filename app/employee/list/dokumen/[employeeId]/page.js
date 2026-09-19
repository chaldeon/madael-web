'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmployeeDocumentsPanel from '@/components/EmployeeDocumentsPanel';

// Dibuka dari menu aksi (⋯) di /employee/list — dokumen bersifat self-service
// (employee upload sendiri lewat halaman Profil), jadi di sini superadmin
// cuma bisa LIHAT + hapus (buat beres-beres), bukan upload atas nama karyawan.
export default function DokumenKaryawanPage() {
  const supabase = createClient();
  const { employeeId } = useParams();
  const { status } = useModuleAccess('employee_list');

  const [target, setTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const loadTarget = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from('employees')
      .select('id, nama, email')
      .eq('id', employeeId)
      .maybeSingle();

    if (error || !data) {
      setLoadError(error?.message || 'Karyawan tidak ditemukan.');
    } else {
      setTarget(data);
    }
    setLoading(false);
  }, [supabase, employeeId]);

  useEffect(() => {
    if (status === 'allowed' && employeeId) loadTarget();
  }, [status, employeeId, loadTarget]);

  if (status === 'loading') {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-10">
        <LoadingState label="Memeriksa akses..." />
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-10">
        <ErrorState message="Kamu tidak punya akses ke halaman ini." />
      </div>
    );
  }

  return (
    <div className="max-w-[800px] mx-auto px-6 py-10">
      <Link href="/employee/list" className="inline-flex items-center gap-1.5 text-xs text-[#6B6B6B] hover:text-black mb-6">
        <ArrowLeft size={13} /> Kembali ke Employee List
      </Link>

      {loading ? (
        <LoadingState label="Memuat data karyawan..." />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={loadTarget} />
      ) : (
        <>
          <div className="mb-8">
            <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Dokumen Karyawan</h1>
            <p className="text-sm text-[#6B6B6B] mt-1">{target.nama} — {target.email}</p>
          </div>

          <EmployeeDocumentsPanel supabase={supabase} employeeId={target.id} canUpload={false} canDelete />
        </>
      )}
    </div>
  );
}