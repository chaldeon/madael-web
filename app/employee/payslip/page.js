'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Receipt, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';

function formatRupiah(value) {
  return 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
}

function calculateTHP(p) {
  const pendapatanTunai =
    (p.gaji_pokok || 0) + (p.lembur || 0) + (p.tunjangan_transport || 0) + (p.tunjangan_lain || 0);
  const totalPotongan =
    (p.jht_karyawan || 0) + (p.jp_karyawan || 0) + (p.bpjs_k_karyawan || 0) + (p.pph21 || 0);
  return pendapatanTunai - totalPotongan;
}

export default function PayslipListPage() {
  const supabase = createClient();

  const [payslips, setPayslips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoadError('Sesi login tidak ditemukan. Silakan login ulang.');
      setLoading(false);
      return;
    }

    const { data: emp, error: empError } = await supabase
      .from('employees')
      .select('id')
      .eq('email', user.email)
      .maybeSingle();

    if (empError) {
      setLoadError(empError.message || 'Gagal memuat data karyawan.');
      setLoading(false);
      return;
    }

    if (!emp) {
      setLoading(false);
      return;
    }

    const { data: slips, error: slipsError } = await supabase
      .from('payslips')
      .select('*')
      .eq('employee_id', emp.id)
      .eq('is_published', true)
      .order('periode', { ascending: false });

    if (slipsError) {
      setLoadError(slipsError.message || 'Gagal memuat slip gaji.');
      setLoading(false);
      return;
    }

    setPayslips(slips || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-1">
        Slip Gaji
      </h1>
      <p className="text-sm text-[#6B6B6B] mb-8">Riwayat slip gaji bulanan kamu.</p>

      {loading ? (
        <LoadingState label="Memuat slip gaji..." />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={loadData} />
      ) : payslips.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0] p-10 text-center">
          <Receipt size={28} className="mx-auto mb-3 text-[#C9C9C9]" />
          <p className="text-sm text-[#6B6B6B]">Belum ada slip gaji tersedia</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {payslips.map((p) => (
            <Link
              key={p.id}
              href={`/employee/payslip/${p.id}`}
              className="flex items-center justify-between bg-white border border-[#E0E0E0] p-5 hover:border-madael-red transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 flex items-center justify-center bg-madael-red text-white shrink-0">
                  <Receipt size={18} />
                </div>
                <div>
                  <p className="text-sm font-medium text-black">
                    {p.periode_label || p.periode}
                  </p>
                  <p className="text-xs text-[#6B6B6B]">
                    Dok. {p.nomor_dokumen || '—'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-xs text-[#6B6B6B]">Take Home Pay</p>
                  <p className="text-sm font-medium text-black">{formatRupiah(calculateTHP(p))}</p>
                </div>
                <ChevronRight size={16} className="text-[#9A9A9A]" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}