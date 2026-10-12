'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { friendlyError } from '@/lib/errorMessage';
import { PERATURAN_MODULE_KEY, DETAIL_COLUMNS } from '@/lib/peraturanConfig';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import PeraturanForm from '@/components/peraturan/PeraturanForm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function UbahPeraturanPage() {
  const params = useParams();
  const id = params.id;
  const supabase = createClient();
  const { employee } = useModuleAccess(PERATURAN_MODULE_KEY);

  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!UUID_RE.test(String(id))) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase
      .from('peraturan')
      .select(DETAIL_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (err) {
      setError(friendlyError(err, 'Gagal memuat peraturan.', { context: 'Muat peraturan untuk diubah' }));
    } else if (!data) {
      setNotFound(true);
    } else {
      setRow(data);
    }
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    load();
  }, [load]);

  const wrapper = 'max-w-[900px] mx-auto px-6 py-10';

  if (loading || !employee) {
    return <div className={wrapper}><LoadingState label="Memuat..." /></div>;
  }
  if (!employee.is_superadmin) {
    return (
      <div className={wrapper}>
        <div className="border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Hanya superadmin yang dapat mengubah peraturan.</p>
          <Link href={`/employee/peraturan/${id}`} className="text-sm text-madael-red hover:text-madael-dark">
            ← Kembali ke peraturan
          </Link>
        </div>
      </div>
    );
  }
  if (error) {
    return <div className={wrapper}><ErrorState message={error} onRetry={load} /></div>;
  }
  if (notFound || !row) {
    return (
      <div className={wrapper}>
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Peraturan tidak ditemukan." />
        </div>
        <Link href="/employee/peraturan" className="inline-block mt-4 text-sm text-madael-red hover:text-madael-dark">
          ← Kembali ke daftar
        </Link>
      </div>
    );
  }

  return (
    <div className={wrapper}>
      <Link
        href={`/employee/peraturan/${row.id}`}
        className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-black mb-6"
      >
        <ArrowLeft size={14} />
        Kembali ke peraturan
      </Link>
      <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-6">Ubah Peraturan</h1>
      <PeraturanForm initialRow={row} employee={employee} />
    </div>
  );
}
