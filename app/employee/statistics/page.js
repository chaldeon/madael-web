'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Eye, Users, Briefcase, FileText, Monitor, Smartphone, Tablet, Printer,
  UserCheck, UserMinus, Clock, Wallet,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { createClient } from '@/lib/supabase-browser';
import ExportCsvButton from '@/components/ExportCsvButton';

const PERIODS = [
  { value: 'weekly', label: 'Mingguan' },
  { value: 'monthly', label: 'Bulanan' },
  { value: 'annually', label: 'Tahunan' },
  { value: 'all', label: 'Semua Waktu' },
];

const TABS = [
  { value: 'traffic', label: 'Traffic & Rekrutmen' },
  { value: 'hr', label: 'HR Analytics' },
];

const MADAEL_RED = '#C1272D';

const PERIOD_LABELS = {
  weekly: 'Minggu Ini',
  monthly: 'Bulan Ini',
  annually: 'Tahun Ini',
  all: 'Semua Waktu',
};

// 6 bulan terakhir (termasuk bulan berjalan), format 'YYYY-MM' — dipakai
// sebagai kerangka X-axis chart tren HR supaya bulan tanpa data tetap
// tampil sebagai 0, bukan hilang dari chart. Sama seperti pola di
// app/employee/reports/page.js.
function last6Months() {
  const out = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function monthLabel(monthValue) {
  return new Date(`${monthValue}-01T00:00:00`).toLocaleDateString('id-ID', {
    month: 'short',
    year: '2-digit',
  });
}

function formatRupiah(value) {
  return 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
}

function SummaryCard({ icon: Icon, label, value }) {
  return (
    <div className="bg-white border border-[#E0E0E0] p-5">
      <div className="w-10 h-10 flex items-center justify-center bg-madael-red text-white mb-4">
        <Icon size={18} />
      </div>
      <p className="text-2xl font-serif text-black tracking-[-0.02em] mb-1">{value}</p>
      <p className="text-xs text-[#6B6B6B]">{label}</p>
    </div>
  );
}

function DeviceIcon({ device }) {
  const d = (device || '').toLowerCase();
  if (d === 'mobile') return <Smartphone size={14} />;
  if (d === 'tablet') return <Tablet size={14} />;
  return <Monitor size={14} />;
}

// --- Tab HR Analytics ---
// Catatan penting soal keterbatasan data (lihat spek fitur "Analytics HR
// Internal"): skema saat ini tidak menyimpan tanggal resign/keluar, hanya
// status employees.status ('Aktif'/'Nonaktif') di titik waktu sekarang.
// Karena itu chart di bawah ini TIDAK menghitung "turnover rate" historis
// (butuh timestamp perubahan status yang belum ada) — sebagai gantinya kita
// tampilkan (1) jumlah karyawan baru per bulan dari employees.created_at
// sebagai proxy tren pertumbuhan, dan (2) jumlah aktif/nonaktif saat ini.
function HrAnalyticsSection({ supabase }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [employees, setEmployees] = useState([]); // { id, status, created_at }
  const [masterRows, setMasterRows] = useState([]); // { status, linked_employee_id }
  const [attendanceRows, setAttendanceRows] = useState([]); // { tanggal, status_telat }
  const [payrollCostByMonth, setPayrollCostByMonth] = useState({}); // { 'YYYY-MM': total }

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const months = last6Months();
    const firstDay = `${months[0]}-01`;

    const [empRes, masterRes, attendanceRes, runsRes] = await Promise.all([
      supabase.from('employees').select('id, status, created_at'),
      supabase.from('employees_master').select('status, linked_employee_id'),
      supabase.from('attendance').select('tanggal, status_telat').gte('tanggal', firstDay),
      supabase.from('payroll_runs').select('id, periode').eq('status', 'Approved').gte('periode', months[0]),
    ]);

    const criticalError = empRes.error || masterRes.error || attendanceRes.error || runsRes.error;
    if (criticalError) {
      setLoadError(criticalError.message || 'Gagal memuat data HR analytics.');
      setLoading(false);
      return;
    }

    setEmployees(empRes.data || []);
    setMasterRows(masterRes.data || []);
    setAttendanceRows(attendanceRes.data || []);

    // Biaya payroll per bulan: payroll_run_items.take_home_pay dijumlah per
    // payroll_runs.periode, dibatasi run berstatus Approved saja (dianggap
    // sudah final/dibayar, bukan sekadar draft).
    const runs = runsRes.data || [];
    if (runs.length === 0) {
      setPayrollCostByMonth({});
    } else {
      const runIds = runs.map((r) => r.id);
      const periodeByRunId = {};
      runs.forEach((r) => { periodeByRunId[r.id] = r.periode; });

      const { data: items, error: itemsError } = await supabase
        .from('payroll_run_items')
        .select('payroll_run_id, take_home_pay')
        .in('payroll_run_id', runIds);

      if (itemsError) {
        setLoadError(itemsError.message || 'Gagal memuat biaya payroll.');
      } else {
        const totals = {};
        (items || []).forEach((item) => {
          const periode = periodeByRunId[item.payroll_run_id];
          if (!periode) return;
          totals[periode] = (totals[periode] || 0) + (Number(item.take_home_pay) || 0);
        });
        setPayrollCostByMonth(totals);
      }
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const totalAktif = useMemo(() => employees.filter((e) => e.status === 'Aktif').length, [employees]);
  const totalNonaktif = useMemo(() => employees.filter((e) => e.status === 'Nonaktif').length, [employees]);

  // Distribusi status kepegawaian (PHL vs Tetap), khusus employees_master
  // yang masih ter-link ke akun aktif — supaya tidak ikut menghitung draft
  // master milik karyawan yang sudah dinonaktifkan.
  const statusDistribusi = useMemo(() => {
    const activeIds = new Set(employees.filter((e) => e.status === 'Aktif').map((e) => e.id));
    const map = {};
    masterRows.forEach((m) => {
      if (!activeIds.has(m.linked_employee_id)) return;
      const label = m.status || 'Belum diisi';
      map[label] = (map[label] || 0) + 1;
    });
    return Object.entries(map).map(([status, jumlah]) => ({ status, jumlah }));
  }, [employees, masterRows]);

  const karyawanBaruPerBulan = useMemo(() => {
    const months = last6Months();
    const map = {};
    months.forEach((m) => { map[m] = 0; });
    employees.forEach((e) => {
      if (!e.created_at) return;
      const d = new Date(e.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (key in map) map[key] += 1;
    });
    return months.map((m) => ({ bulan: monthLabel(m), jumlah: map[m] }));
  }, [employees]);

  const keterlambatanPerBulan = useMemo(() => {
    const months = last6Months();
    const totals = {};
    months.forEach((m) => { totals[m] = { total: 0, telat: 0 }; });
    attendanceRows.forEach((row) => {
      if (!row.tanggal) return;
      const key = row.tanggal.slice(0, 7);
      if (!(key in totals)) return;
      totals[key].total += 1;
      if (row.status_telat) totals[key].telat += 1;
    });
    return months.map((m) => ({
      bulan: monthLabel(m),
      persenTelat: totals[m].total > 0 ? Math.round((totals[m].telat / totals[m].total) * 100) : 0,
    }));
  }, [attendanceRows]);

  const biayaPayrollPerBulan = useMemo(() => {
    const months = last6Months();
    return months.map((m) => ({ bulan: monthLabel(m), total: payrollCostByMonth[m] || 0 }));
  }, [payrollCostByMonth]);

  if (loadError) {
    return (
      <div className="border border-madael-red bg-white p-4 text-sm text-madael-red">
        {loadError}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <SummaryCard icon={UserCheck} label="Karyawan Aktif" value={loading ? '—' : totalAktif.toLocaleString('id-ID')} />
        <SummaryCard icon={UserMinus} label="Karyawan Nonaktif" value={loading ? '—' : totalNonaktif.toLocaleString('id-ID')} />
        <SummaryCard
          icon={Clock}
          label="Keterlambatan Bulan Ini"
          value={loading ? '—' : `${keterlambatanPerBulan[keterlambatanPerBulan.length - 1]?.persenTelat ?? 0}%`}
        />
        <SummaryCard
          icon={Wallet}
          label="Biaya Payroll Bulan Ini"
          value={loading ? '—' : formatRupiah(biayaPayrollPerBulan[biayaPayrollPerBulan.length - 1]?.total)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white border border-[#E0E0E0] p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-sm font-medium text-black">Karyawan Baru per Bulan</p>
            <ExportCsvButton
              filename="karyawan-baru-per-bulan"
              headers={[{ key: 'bulan', label: 'Bulan' }, { key: 'jumlah', label: 'Jumlah' }]}
              rows={karyawanBaruPerBulan}
            />
          </div>
          {loading ? (
            <p className="text-xs text-[#6B6B6B]">Memuat chart...</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={karyawanBaruPerBulan}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
                <XAxis dataKey="bulan" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="jumlah" fill={MADAEL_RED} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white border border-[#E0E0E0] p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-sm font-medium text-black">Distribusi Status Kepegawaian</p>
            <ExportCsvButton
              filename="distribusi-status-kepegawaian"
              headers={[{ key: 'status', label: 'Status' }, { key: 'jumlah', label: 'Jumlah' }]}
              rows={statusDistribusi}
            />
          </div>
          {loading ? (
            <p className="text-xs text-[#6B6B6B]">Memuat chart...</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusDistribusi}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
                <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="jumlah" fill={MADAEL_RED} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#E0E0E0] p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-sm font-medium text-black">Tren Keterlambatan (% dari Absensi)</p>
            <ExportCsvButton
              filename="tren-keterlambatan"
              headers={[{ key: 'bulan', label: 'Bulan' }, { key: 'persenTelat', label: '% Telat' }]}
              rows={keterlambatanPerBulan}
            />
          </div>
          {loading ? (
            <p className="text-xs text-[#6B6B6B]">Memuat chart...</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={keterlambatanPerBulan}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
                <XAxis dataKey="bulan" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} unit="%" />
                <Tooltip />
                <Line type="monotone" dataKey="persenTelat" stroke={MADAEL_RED} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white border border-[#E0E0E0] p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-sm font-medium text-black">Tren Biaya Payroll (Take Home Pay)</p>
            <ExportCsvButton
              filename="tren-biaya-payroll"
              headers={[{ key: 'bulan', label: 'Bulan' }, { key: 'total', label: 'Total THP' }]}
              rows={biayaPayrollPerBulan}
            />
          </div>
          {loading ? (
            <p className="text-xs text-[#6B6B6B]">Memuat chart...</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={biayaPayrollPerBulan}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
                <XAxis dataKey="bulan" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} tickFormatter={(v) => `${Math.round(v / 1000000)}jt`} />
                <Tooltip formatter={(v) => formatRupiah(v)} />
                <Bar dataKey="total" fill={MADAEL_RED} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </>
  );
}

export default function StatisticsPage() {
  const supabase = createClient();

  const [tab, setTab] = useState('traffic');
  const [period, setPeriod] = useState('monthly');
  const [gaData, setGaData] = useState(null);
  const [gaLoading, setGaLoading] = useState(true);
  const [gaError, setGaError] = useState(null);

  const [applications, setApplications] = useState([]);
  const [jobListings, setJobListings] = useState([]);
  const [supabaseLoading, setSupabaseLoading] = useState(true);

  // --- Fetch Google Analytics data (refetch tiap ganti periode) ---
  const loadGaData = useCallback(async (selectedPeriod) => {
    setGaLoading(true);
    setGaError(null);
    try {
      const res = await fetch(`/api/analytics?period=${selectedPeriod}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal memuat data analytics');
      setGaData(json);
    } catch (err) {
      setGaError(err.message);
    } finally {
      setGaLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGaData(period);
  }, [period, loadGaData]);

  // --- Fetch data internal Supabase (sekali saja) ---
  useEffect(() => {
    (async () => {
      setSupabaseLoading(true);
      const [{ data: apps }, { data: jobs }] = await Promise.all([
        supabase
          .from('applications')
          .select('id, created_at, job_id, job_listings(title)'),
        supabase
          .from('job_listings')
          .select('id, title, is_active'),
      ]);
      setApplications(apps || []);
      setJobListings(jobs || []);
      setSupabaseLoading(false);
    })();
  }, [supabase]);

  const totalPelamar = applications.length;
  const totalLowonganAktif = jobListings.filter((j) => j.is_active).length;

  const pelamarPerPosisi = useMemo(() => {
    const map = {};
    applications.forEach((app) => {
      const title = app.job_listings?.title || 'Tidak diketahui';
      map[title] = (map[title] || 0) + 1;
    });
    return Object.entries(map)
      .map(([posisi, jumlah]) => ({ posisi, jumlah }))
      .sort((a, b) => b.jumlah - a.jumlah);
  }, [applications]);

  const applyPerBulan = useMemo(() => {
    const map = {};
    applications.forEach((app) => {
      const d = new Date(app.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      map[key] = (map[key] || 0) + 1;
    });
    return Object.entries(map)
      .map(([bulan, jumlah]) => ({ bulan, jumlah }))
      .sort((a, b) => (a.bulan > b.bulan ? 1 : -1));
  }, [applications]);

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-1">
            Dashboard Statistik
          </h1>
          <p className="text-sm text-[#6B6B6B]">
            Data visitor website, aktivitas recruitment, dan analytics HR internal.
          </p>
        </div>
        <div className="flex items-center gap-4 print:hidden">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B6B6B] hover:text-black"
          >
            <Printer size={13} /> Export PDF
          </button>
          {tab === 'traffic' && (
            <div className="flex border border-[#E0E0E0] bg-white">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`px-4 py-2 text-xs font-medium tracking-[0.04em] transition-colors ${
                    period === p.value
                      ? 'bg-madael-red text-white'
                      : 'text-[#6B6B6B] hover:text-black'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex border-b border-[#E0E0E0] mb-8 print:hidden">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`px-4 py-2.5 text-sm font-medium tracking-[0.01em] border-b-2 -mb-px transition-colors ${
              tab === t.value
                ? 'border-madael-red text-black'
                : 'border-transparent text-[#6B6B6B] hover:text-black'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'hr' ? (
        <HrAnalyticsSection supabase={supabase} />
      ) : (
      <>
      {gaError && (
        <div className="mb-6 border border-madael-red bg-white p-4 text-sm text-madael-red">
          {gaError}
        </div>
      )}

      {/* Section 1 — Kartu ringkasan */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <SummaryCard
          icon={Users}
          label={`Total Visitor (${PERIOD_LABELS[period]})`}
          value={gaLoading ? '—' : (gaData?.totalUsers ?? 0).toLocaleString('id-ID')}
        />
        <SummaryCard
          icon={Eye}
          label="Total Pageviews"
          value={gaLoading ? '—' : (gaData?.totalPageviews ?? 0).toLocaleString('id-ID')}
        />
        <SummaryCard
          icon={FileText}
          label="Total Pelamar"
          value={supabaseLoading ? '—' : totalPelamar.toLocaleString('id-ID')}
        />
        <SummaryCard
          icon={Briefcase}
          label="Total Lowongan Aktif"
          value={supabaseLoading ? '—' : totalLowonganAktif.toLocaleString('id-ID')}
        />
      </div>

      {/* Section 2 — Chart visitor per hari */}
      <div className="bg-white border border-[#E0E0E0] p-5 mb-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <p className="text-sm font-medium text-black">
            Sessions {period === 'annually' || period === 'all' ? 'per Bulan' : 'per Hari'}
          </p>
          <ExportCsvButton
            filename={`sessions-${period}`}
            headers={[{ key: 'date', label: 'Tanggal/Bulan' }, { key: 'sessions', label: 'Sessions' }]}
            rows={gaData?.sessionsPerDay || []}
          />
        </div>
        {gaLoading ? (
          <p className="text-xs text-[#6B6B6B]">Memuat chart...</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={gaData?.sessionsPerDay || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="sessions"
                stroke={MADAEL_RED}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Section 3 — Top halaman */}
        <div className="bg-white border border-[#E0E0E0] p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-sm font-medium text-black">Top Halaman</p>
            <ExportCsvButton
              filename={`top-halaman-${period}`}
              headers={[{ key: 'page', label: 'Halaman' }, { key: 'pageviews', label: 'Pageviews' }]}
              rows={gaData?.topPages || []}
            />
          </div>
          {gaLoading ? (
            <p className="text-xs text-[#6B6B6B]">Memuat data...</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[#6B6B6B] border-b border-[#E0E0E0]">
                  <th className="pb-2 font-medium">Halaman</th>
                  <th className="pb-2 font-medium text-right">Pageviews</th>
                </tr>
              </thead>
              <tbody>
                {(gaData?.topPages || []).map((row) => (
                  <tr key={row.page} className="border-b border-[#F0F0F0]">
                    <td className="py-2 text-black truncate max-w-[220px]">{row.page}</td>
                    <td className="py-2 text-right text-[#6B6B6B]">
                      {row.pageviews.toLocaleString('id-ID')}
                    </td>
                  </tr>
                ))}
                {(gaData?.topPages || []).length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-4 text-center text-[#9A9A9A]">
                      Belum ada data
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Section 4 — Breakdown device */}
        <div className="bg-white border border-[#E0E0E0] p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-sm font-medium text-black">Breakdown Device</p>
            <ExportCsvButton
              filename={`breakdown-device-${period}`}
              headers={[{ key: 'device', label: 'Device' }, { key: 'sessions', label: 'Sessions' }]}
              rows={gaData?.deviceBreakdown || []}
            />
          </div>
          {gaLoading ? (
            <p className="text-xs text-[#6B6B6B]">Memuat chart...</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={gaData?.deviceBreakdown || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
                <XAxis dataKey="device" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="sessions" fill={MADAEL_RED} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="flex gap-4 mt-3">
            {(gaData?.deviceBreakdown || []).map((d) => (
              <div key={d.device} className="flex items-center gap-1.5 text-xs text-[#6B6B6B]">
                <DeviceIcon device={d.device} />
                {d.device}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section 5 — Data internal recruitment */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-[#E0E0E0] p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-sm font-medium text-black">Pelamar per Posisi</p>
            <ExportCsvButton
              filename="pelamar-per-posisi"
              headers={[{ key: 'posisi', label: 'Posisi' }, { key: 'jumlah', label: 'Jumlah Pelamar' }]}
              rows={pelamarPerPosisi}
            />
          </div>
          {supabaseLoading ? (
            <p className="text-xs text-[#6B6B6B]">Memuat data...</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[#6B6B6B] border-b border-[#E0E0E0]">
                  <th className="pb-2 font-medium">Posisi</th>
                  <th className="pb-2 font-medium text-right">Jumlah Pelamar</th>
                </tr>
              </thead>
              <tbody>
                {pelamarPerPosisi.map((row) => (
                  <tr key={row.posisi} className="border-b border-[#F0F0F0]">
                    <td className="py-2 text-black">{row.posisi}</td>
                    <td className="py-2 text-right text-[#6B6B6B]">{row.jumlah}</td>
                  </tr>
                ))}
                {pelamarPerPosisi.length === 0 && (
                  <tr>
                    <td colSpan={2} className="py-4 text-center text-[#9A9A9A]">
                      Belum ada pelamar
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white border border-[#E0E0E0] p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-sm font-medium text-black">Apply per Bulan</p>
            <ExportCsvButton
              filename="apply-per-bulan"
              headers={[{ key: 'bulan', label: 'Bulan' }, { key: 'jumlah', label: 'Jumlah Apply' }]}
              rows={applyPerBulan}
            />
          </div>
          {supabaseLoading ? (
            <p className="text-xs text-[#6B6B6B]">Memuat chart...</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={applyPerBulan}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E0E0E0" />
                <XAxis dataKey="bulan" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="jumlah" fill={MADAEL_RED} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}