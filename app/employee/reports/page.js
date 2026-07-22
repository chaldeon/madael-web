'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { Clock, Wallet, Receipt, Briefcase } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatRupiah(value) {
  return 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
}

function StatCard({ icon: Icon, label, value, subtext }) {
  return (
    <div className="bg-white border border-[#E0E0E0] p-6">
      <div className="flex items-center gap-2 text-[#6B6B6B] mb-3">
        <Icon size={16} />
        <span className="text-xs uppercase tracking-[0.04em]">{label}</span>
      </div>
      <p className="text-3xl font-serif text-black">{value}</p>
      {subtext && <p className="text-xs text-[#9A9A9A] mt-1">{subtext}</p>}
    </div>
  );
}

export default function ReportsDashboardPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [stats, setStats] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const monthValue = currentMonthValue();
    const firstDay = `${monthValue}-01`;
    const [year, month] = monthValue.split('-').map(Number);
    const lastDayNum = new Date(year, month, 0).getDate();
    const lastDay = `${monthValue}-${String(lastDayNum).padStart(2, '0')}`;

    // Query masing-masing modul secara paralel. Tabel invoices dianggap opsional
    // (kalau Task 16 belum jalan di environment ini, jangan sampai halaman error total).
    const [attendanceRes, payrollRes, invoicesRes, applicationsRes] = await Promise.all([
      supabase
        .from('attendance')
        .select('id', { count: 'exact', head: true })
        .gte('tanggal', firstDay)
        .lte('tanggal', lastDay),
      supabase
        .from('payroll_runs')
        .select('id', { count: 'exact', head: true })
        .eq('periode', monthValue)
        .eq('status', 'Approved'),
      supabase
        .from('invoices')
        .select('nominal', { count: 'exact' })
        .neq('status', 'lunas'),
      supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .not('status', 'in', '(Ditolak,Diterima)'),
    ]);

    const criticalError = attendanceRes.error || payrollRes.error || applicationsRes.error;
    if (criticalError) {
      setLoadError(criticalError.message || 'Gagal memuat data ringkasan.');
      setLoading(false);
      return;
    }

    const invoiceCount = invoicesRes.error ? null : invoicesRes.count || 0;
    const invoiceTotal = invoicesRes.error
      ? 0
      : (invoicesRes.data || []).reduce((sum, i) => sum + (Number(i.nominal) || 0), 0);

    setStats({
      totalKehadiran: attendanceRes.count || 0,
      payrollApproved: payrollRes.count || 0,
      invoiceOutstandingCount: invoiceCount,
      invoiceOutstandingTotal: invoiceTotal,
      kandidatAktif: applicationsRes.count || 0,
      monthLabel: new Date(`${monthValue}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }),
    });
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <LoadingState label="Memuat ringkasan..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Reports Dashboard</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">Ringkasan lintas modul untuk periode {stats.monthLabel}. Murni read-only.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          icon={Clock}
          label="Total Kehadiran Bulan Ini"
          value={stats.totalKehadiran}
          subtext="Jumlah record absensi (semua karyawan)"
        />
        <StatCard
          icon={Wallet}
          label="Payroll Approved Bulan Ini"
          value={stats.payrollApproved}
          subtext="Jumlah payroll run berstatus Approved"
        />
        <StatCard
          icon={Receipt}
          label="Invoice Outstanding"
          value={stats.invoiceOutstandingCount === null ? '—' : stats.invoiceOutstandingCount}
          subtext={
            stats.invoiceOutstandingCount === null
              ? 'Tabel invoices belum tersedia (Task 16 belum jalan di environment ini)'
              : `Total nominal: ${formatRupiah(stats.invoiceOutstandingTotal)}`
          }
        />
        <StatCard
          icon={Briefcase}
          label="Kandidat Aktif — Job Portal"
          value={stats.kandidatAktif}
          subtext="Status selain Ditolak / Diterima"
        />
      </div>
    </div>
  );
}