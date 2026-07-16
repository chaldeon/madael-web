'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Eye, Users, Briefcase, FileText, Monitor, Smartphone, Tablet,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { createClient } from '@/lib/supabase-browser';

const PERIODS = [
  { value: '7', label: '7 Hari' },
  { value: '30', label: '30 Hari' },
  { value: '90', label: '90 Hari' },
];

const MADAEL_RED = '#C1272D';

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

export default function StatisticsPage() {
  const supabase = createClient();

  const [period, setPeriod] = useState('30');
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
      const res = await fetch(`/api/analytics?days=${selectedPeriod}`);
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
            Data visitor website dan aktivitas recruitment.
          </p>
        </div>
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
      </div>

      {gaError && (
        <div className="mb-6 border border-madael-red bg-white p-4 text-sm text-madael-red">
          {gaError}
        </div>
      )}

      {/* Section 1 — Kartu ringkasan */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <SummaryCard
          icon={Users}
          label={`Total Visitor (${period} hari)`}
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
        <p className="text-sm font-medium text-black mb-4">Sessions per Hari</p>
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
          <p className="text-sm font-medium text-black mb-4">Top Halaman</p>
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
          <p className="text-sm font-medium text-black mb-4">Breakdown Device</p>
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
          <p className="text-sm font-medium text-black mb-4">Pelamar per Posisi</p>
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
          <p className="text-sm font-medium text-black mb-4">Apply per Bulan</p>
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
    </div>
  );
}