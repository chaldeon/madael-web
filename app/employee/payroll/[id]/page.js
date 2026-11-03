'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import { formatRupiahOrDash } from '@/lib/format';
import { friendlyCaught } from '@/lib/errorMessage';
import EmployeeDocumentsPanel from '@/components/EmployeeDocumentsPanel';
import KontrakBadge from '@/components/KontrakBadge';
import { formatTanggalKepegawaian, masaKerja } from '@/lib/kepegawaian';

function totalTunjangan(row) {
  const komponenTotal = Object.values(row?.komponen_lain || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);
  return (Number(row?.tunjangan) || 0) + komponenTotal;
}

function Field({ label, children }) {
  return (
    <div>
      <p className="text-xs font-medium text-[#6B6B6B] uppercase tracking-[0.04em] mb-1">{label}</p>
      <p className="text-sm text-black">{children}</p>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const params = useParams();
  const supabase = createClient();
  const { status: accessStatus, employee: actingEmployee } = useModuleAccess('payroll');

  const [empMaster, setEmpMaster] = useState(null);
  const [clientName, setClientName] = useState('-');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const isSuperadmin = !!actingEmployee?.is_superadmin;

  const loadEmployee = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);

    // Lewat API route (cek modul payroll di server), bukan select * dari browser.
    let data = null;
    try {
      const res = await fetch(`/api/payroll/master/${encodeURIComponent(params.id)}`);
      const body = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setLoadError(body.error || 'Gagal memuat data employee.');
        setLoading(false);
        return;
      }
      data = body.data;
    } catch (err) {
      setLoadError(friendlyCaught(err, 'Gagal memuat data employee.'));
      setLoading(false);
      return;
    }
    if (!data) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setEmpMaster(data);
    setClientName(data.companies?.nama_perusahaan || '-');
    setLoading(false);
  }, [supabase, params.id]);

  useEffect(() => {
    if (accessStatus === 'allowed' && isSuperadmin) {
      loadEmployee();
    }
  }, [accessStatus, isSuperadmin, loadEmployee]);

  if (accessStatus === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat..." />
      </section>
    );
  }

  if (accessStatus === 'denied' || !isSuperadmin) {
    return (
      <div className="max-w-[600px] mx-auto px-6 py-10">
        <div className="w-full border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Halaman detail employee khusus superadmin.</p>
          <Link href="/employee/payroll" className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors">
            Kembali
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <LoadingState label="Memuat data employee..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[420px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadEmployee} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-[600px] mx-auto px-6 py-10">
        <p className="text-sm text-black mb-6">Employee tidak ditemukan.</p>
        <Link href="/employee/payroll" className="inline-flex items-center gap-1.5 text-sm text-madael-red hover:underline">
          <ArrowLeft size={15} /> Kembali ke Payroll
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <Link href="/employee/payroll" className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-madael-red transition-colors mb-6">
        <ArrowLeft size={15} /> Kembali ke Payroll
      </Link>

      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">{empMaster.nama}</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">{empMaster.posisi || '—'} · {clientName}</p>
      </div>

      <div className="bg-white border border-[#E0E0E0] p-8 mb-8">
        <h2 className="text-sm font-semibold text-black mb-4">Data Employee Master</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
          <Field label="Status">{empMaster.status || '-'}</Field>
          <Field label="Klien">{clientName}</Field>
          <Field label="Posisi">{empMaster.posisi || '-'}</Field>
          <Field label="Tanggal Bergabung">{formatTanggalKepegawaian(empMaster.tanggal_bergabung)}</Field>
          <Field label="Masa Kerja">{empMaster.tanggal_bergabung ? masaKerja(empMaster.tanggal_bergabung) : '-'}</Field>
          <Field label="Jenis Hubungan Kerja">{empMaster.jenis_hubungan_kerja || '-'}</Field>
          <Field label="Kontrak Berakhir">
            <span className="inline-flex flex-wrap items-center gap-2">
              {formatTanggalKepegawaian(empMaster.kontrak_berakhir)}
              <KontrakBadge kontrakBerakhir={empMaster.kontrak_berakhir} />
            </span>
          </Field>
          <Field label="Gaji Pokok">{formatRupiahOrDash(empMaster.gaji_pokok)}</Field>
          <Field label="Total Tunjangan">{formatRupiahOrDash(totalTunjangan(empMaster))}</Field>
          <Field label="Jatah Cuti Tahunan">{empMaster.jatah_cuti_tahunan ?? 12} hari</Field>
          <Field label="Nama Rekening">{empMaster.nama_rekening || '-'}</Field>
          <Field label="No Rekening">{empMaster.no_rekening || '-'}</Field>
        </div>
        <p className="text-[11px] text-[#9A9A9A] mt-5">
          Untuk edit struktur gaji, PTKP, NPWP, dsb — pakai tombol Edit di tabel Payroll.
        </p>
      </div>

      <div className="bg-white border border-[#E0E0E0] p-8">
        <h2 className="text-sm font-semibold text-black mb-1">Dokumen Employee</h2>
        <p className="text-xs text-[#6B6B6B] mb-5">
          KTP, kontrak/PKWT, ijazah, dan dokumen lain — tersimpan di Shared Drive, dikelompokkan per employee.
          Dokumen yang diunggah karyawan sendiri lewat halaman Profil juga tampil di sini.
        </p>
        <EmployeeDocumentsPanel employeeId={params.id} canUpload />
      </div>
    </div>
  );
}