'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Clock, Wallet, Receipt, Briefcase } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts';
import { createClient } from '@/lib/supabase-browser';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';

const MADAEL_RED = '#C1272D';
const STATUS_COLOR = { Draft: '#9CA3AF', Review: '#F59E0B', Approved: '#16A34A' };

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 6 bulan terakhir (termasuk bulan berjalan), format 'YYYY-MM' — dipakai
// sebagai kerangka X-axis tren kehadiran supaya bulan tanpa data tetap
// tampil sebagai 0, bukan hilang dari chart.
function last6Months() {
  const out = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
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

  const [attendanceRows, setAttendanceRows] = useState([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState(null);

  const [payrollPeriode, setPayrollPeriode] = useState(currentMonthValue());
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [payrollLoading, setPayrollLoading] = useState(true);
  const [payrollError, setPayrollError] = useState(null);

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

  // Chart 1 — Tren kehadiran per bulan (6 bulan terakhir).
  const loadTrend = useCallback(async () => {
    setTrendLoading(true);
    setTrendError(null);

    const months = last6Months();
    const firstDay = `${months[0]}-01`;

    const { data, error } = await supabase
      .from('attendance')
      .select('tanggal')
      .gte('tanggal', firstDay);

    if (error) {
      setTrendError(error.message || 'Gagal memuat tren kehadiran.');
      setTrendLoading(false);
      return;
    }

    setAttendanceRows(data || []);
    setTrendLoading(false);
  }, [supabase]);

  // Chart 2 — Breakdown status payroll per klien, untuk periode yang dipilih.
  const loadPayrollBreakdown = useCallback(async (periode) => {
    setPayrollLoading(true);
    setPayrollError(null);

    const { data, error } = await supabase
      .from('payroll_runs')
      .select('status, payroll_clients ( nama_klien )')
      .eq('periode', periode);

    if (error) {
      setPayrollError(error.message || 'Gagal memuat breakdown payroll.');
      setPayrollLoading(false);
      return;
    }

    setPayrollRuns(data || []);
    setPayrollLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadTrend(); }, [loadTrend]);
  useEffect(() => { loadPayrollBreakdown(payrollPeriode); }, [payrollPeriode, loadPayrollBreakdown]);

  const attendanceTrend = useMemo(() => {
    const map = {};
    last6Months().forEach((bulan) => { map[bulan] = 0; });
    attendanceRows.forEach((row) => {
      const key = (row.tanggal || '').slice(0, 7); // 'YYYY-MM-DD' -> 'YYYY-MM'
      if (key in map) map[key] += 1;
    });
    return Object.entries(map).map(([bulan, jumlah]) => ({ bulan, jumlah }));
  }, [attendanceRows]);

  const payrollByClient = useMemo(() => {
    const map = {};
    payrollRuns.forEach((run) => {
      const klien = run.payroll_clients?.nama_klien || 'Tanpa Klien';
      if (!map[klien]) map[klien] = { klien, Draft: 0, Review: 0, Approved: 0 };
      if (run.status in map[klien]) map[klien][run.status] += 1;
    });
    return Object.values(map).sort((a, b) => a.klien.localeCompare(b.klien));
  }, [payrollRuns]);

  if (loading) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-10">
        <LoadingState label="Memuat ringkasan..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Reports Dashboard</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">Ringkasan lintas modul untuk periode {stats.monthLabel}. Murni read-only.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
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

      {/* Chart 1 — Tren Kehadiran per Bulan */}
      <div className="bg-white border border-[#E0E0E0] p-5 mb-6">
        <p className="text-sm font-medium text-black mb-4">Tren Kehadiran per Bulan (6 Bulan Terakhir)</p>
        {trendError ? (
          <p className="text-xs text-madael-red">{trendError}</p>
        ) : trendLoading ? (
          <p className="text-xs text-[#6B6B6B]">Memuat chart...</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={attendanceTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
              <XAxis dataKey="bulan" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="jumlah"
                name="Total Kehadiran"
                stroke={MADAEL_RED}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Chart 2 — Breakdown Status Payroll per Klien */}
      <div className="bg-white border border-[#E0E0E0] p-5">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <p className="text-sm font-medium text-black">Breakdown Status Payroll per Klien</p>
          <input
            type="month"
            value={payrollPeriode}
            onChange={(e) => setPayrollPeriode(e.target.value)}
            className="border border-[#E0E0E0] px-3 py-1.5 text-xs text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
          />
        </div>
        {payrollError ? (
          <p className="text-xs text-madael-red">{payrollError}</p>
        ) : payrollLoading ? (
          <p className="text-xs text-[#6B6B6B]">Memuat chart...</p>
        ) : payrollByClient.length === 0 ? (
          <p className="text-xs text-[#9A9A9A]">Belum ada payroll run untuk periode ini.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={payrollByClient}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
              <XAxis dataKey="klien" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Draft" fill={STATUS_COLOR.Draft} />
              <Bar dataKey="Review" fill={STATUS_COLOR.Review} />
              <Bar dataKey="Approved" fill={STATUS_COLOR.Approved} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}