'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

function formatRupiah(value) {
  return 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
}

function formatTanggal(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function Row({ label, value, bold }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#F0F0F0]">
      <span className={`text-xs ${bold ? 'font-medium text-black' : 'text-[#6B6B6B]'}`}>{label}</span>
      <span className={`text-xs ${bold ? 'font-medium text-black' : 'text-[#3D3D3D]'}`}>{value}</span>
    </div>
  );
}

export default function PayslipDetailPage() {
  const params = useParams();
  const supabase = createClient();

  const [payslip, setPayslip] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: currentEmp } = await supabase
      .from('employees')
      .select('id, is_superadmin')
      .eq('email', user.email)
      .maybeSingle();

    if (!currentEmp) {
      setError('Akun ini belum terdaftar sebagai employee. Hubungi superadmin.');
      setLoading(false);
      return;
    }

    const { data: slip, error: slipError } = await supabase
      .from('payslips')
      .select('*, employees ( nama, employee_id )')
      .eq('id', params.id)
      .maybeSingle();

    if (slipError || !slip) {
      setError('Slip gaji tidak ditemukan.');
      setLoading(false);
      return;
    }

    const isOwner = slip.employee_id === currentEmp.id;
    if (!isOwner && !currentEmp.is_superadmin) {
      setError('Kamu tidak punya akses ke slip gaji ini.');
      setLoading(false);
      return;
    }

    if (!slip.is_published && !currentEmp.is_superadmin) {
      setError('Slip gaji ini belum dipublikasikan.');
      setLoading(false);
      return;
    }

    setPayslip(slip);
    setEmployee(slip.employees);
    setLoading(false);
  }, [supabase, params.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return <p className="text-sm text-[#6B6B6B] px-6 py-10">Memuat...</p>;
  }

  if (error) {
    return (
      <div className="max-w-[420px] mx-auto mt-16 border-t-4 border-madael-red bg-white p-8 text-center">
        <p className="text-sm text-black mb-6">{error}</p>
        <Link
          href="/employee/payslip"
          className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
        >
          Kembali
        </Link>
      </div>
    );
  }

  const p = payslip;
  const bpjsTkPerusahaan =
    p.bpjs_tk_perusahaan ??
    (p.jkk_perusahaan || 0) + (p.jkm_perusahaan || 0) + (p.jht_perusahaan || 0) + (p.jp_perusahaan || 0);
  const totalPendapatan =
    (p.gaji_pokok || 0) + (p.lembur || 0) + (p.tunjangan_transport || 0) + (p.tunjangan_lain || 0) +
    bpjsTkPerusahaan + (p.bpjs_k_perusahaan || 0);
  const totalPotongan =
    (p.jht_karyawan || 0) + (p.jp_karyawan || 0) + (p.bpjs_k_karyawan || 0) + (p.pph21 || 0);
  const takeHomePay =
    (p.gaji_pokok || 0) + (p.lembur || 0) + (p.tunjangan_transport || 0) + (p.tunjangan_lain || 0) - totalPotongan;

  return (
    <div className="max-w-[820px] mx-auto px-6 py-10 print:py-0 print:px-0 print:max-w-none">
      <div className="print:hidden flex items-center justify-between mb-4">
        <Link href="/employee/payslip" className="flex items-center gap-2 text-sm text-[#6B6B6B] hover:text-madael-red transition-colors">
          <ArrowLeft size={16} />
          Slip Gaji
        </Link>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-madael-red text-white px-5 py-2 text-[13px] font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
        >
          <Printer size={15} />
          Download PDF
        </button>
      </div>

      <div className="bg-white border border-[#E0E0E0] print:border-0 p-10 print:p-8">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-madael-red pb-6 mb-6">
          <div className="flex items-center gap-4">
            <img src="/logos/madael_logo_transparent.png" alt="Madael" className="w-14 h-14 object-contain" />
            <div>
              <p className="font-serif text-lg text-black tracking-[-0.01em]">MADAEL CONSULT</p>
              <p className="text-xs text-[#6B6B6B]">PT. MADAEL PRIMA SEJAHTERA INDONESIA</p>
              <p className="text-xs text-[#6B6B6B]">Hive Five Kelapa Gading</p>
            </div>
          </div>
          <span className="text-[11px] font-medium tracking-[0.06em] text-madael-red border border-madael-red px-2.5 py-1">
            DOKUMEN RAHASIA
          </span>
        </div>

        {/* Info karyawan */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-8 text-xs">
          <Row label="Nomor Dokumen" value={p.nomor_dokumen || '—'} />
          <Row label="Nama Karyawan" value={employee?.nama || '—'} />
          <Row label="Rekening" value={p.rekening || '—'} />
          <Row label="Perihal" value={`Penggajian Periode ${p.periode_label || p.periode}`} />
        </div>

        {/* Pendapatan vs Potongan */}
        <div className="grid grid-cols-2 gap-8 mb-4">
          <div>
            <p className="text-xs font-medium tracking-[0.06em] text-black border-b border-[#E0E0E0] pb-2 mb-1">
              PENDAPATAN
            </p>
            <Row label="Gaji Pokok" value={formatRupiah(p.gaji_pokok)} />
            <Row label="Lembur" value={formatRupiah(p.lembur)} />
            <Row label="Tunjangan Transport" value={formatRupiah(p.tunjangan_transport)} />
            <Row label="Tunjangan Lain" value={formatRupiah(p.tunjangan_lain)} />
            <Row label="BPJS TK Perusahaan" value={formatRupiah(bpjsTkPerusahaan)} />
            <Row label="BPJS K Perusahaan" value={formatRupiah(p.bpjs_k_perusahaan)} />
            <Row label="Total Pendapatan" value={formatRupiah(totalPendapatan)} bold />
          </div>
          <div>
            <p className="text-xs font-medium tracking-[0.06em] text-black border-b border-[#E0E0E0] pb-2 mb-1">
              POTONGAN
            </p>
            <Row label="BPJS TK Karyawan (JHT)" value={formatRupiah(p.jht_karyawan)} />
            <Row label="BPJS TK Karyawan (JP)" value={formatRupiah(p.jp_karyawan)} />
            <Row label="BPJS K Karyawan" value={formatRupiah(p.bpjs_k_karyawan)} />
            <Row label="PPh 21" value={formatRupiah(p.pph21)} />
            <Row label="Total Potongan" value={formatRupiah(totalPotongan)} bold />
          </div>
        </div>

        {/* Take Home Pay */}
        <div className="flex items-center justify-between bg-[#F4F4F4] px-5 py-4 mb-8">
          <span className="text-sm font-medium text-black">Take Home Pay</span>
          <span className="text-lg font-serif text-madael-red">{formatRupiah(takeHomePay)}</span>
        </div>

        {/* Keterangan */}
        <div className="text-xs text-[#6B6B6B] mb-2">
          <p>Metode Pembayaran: {p.metode_pembayaran || 'Transfer'}</p>
          <p>Tanggal Pembayaran: {formatTanggal(p.tanggal_pembayaran)}</p>
        </div>

        {/* Halaman 2 — Data Pajak & BPJS */}
        <div className="print:break-before-page mt-10 print:mt-0 pt-8 border-t border-[#E0E0E0] print:border-0">
          <p className="font-serif text-base text-black mb-4">Data Pajak &amp; BPJS</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs max-w-[500px]">
            <Row label="NPWP" value={p.npwp || '—'} />
            <Row label="PTKP" value={p.ptkp || '—'} />
            <Row label="Nomor BPJS Kesehatan" value={p.no_bpjs_k || '—'} />
            <Row label="Nomor BPJS Ketenagakerjaan" value={p.no_bpjs_tk || '—'} />
          </div>
        </div>
      </div>
    </div>
  );
}