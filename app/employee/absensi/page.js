'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { MapPin, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

const HARI_LABEL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeStr(date) {
  return date.toTimeString().slice(0, 8); // HH:MM:SS, dibandingkan sebagai string vs kolom time
}

function formatJam(value) {
  if (!value) return '—';
  return value.slice(0, 5); // HH:MM
}

function formatWaktu(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Browser ini tidak mendukung deteksi lokasi.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
    });
  });
}

export default function AbsensiPage() {
  const supabase = createClient();

  const [employee, setEmployee] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [todayRow, setTodayRow] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [geoError, setGeoError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: emp } = await supabase
      .from('employees')
      .select('id, nama, is_superadmin')
      .eq('email', user.email)
      .maybeSingle();

    if (!emp) {
      setLoading(false);
      return;
    }
    setEmployee(emp);

    const [{ data: sched }, { data: today }, { data: hist }] = await Promise.all([
      supabase.from('work_schedule').select('*').eq('employee_id', emp.id).maybeSingle(),
      supabase.from('attendance').select('*').eq('employee_id', emp.id).eq('tanggal', todayStr()).maybeSingle(),
      supabase
        .from('attendance')
        .select('*')
        .eq('employee_id', emp.id)
        .order('tanggal', { ascending: false })
        .limit(7),
    ]);

    setSchedule(sched || null);
    setTodayRow(today || null);
    setHistory(hist || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleClockIn = async () => {
    setGeoError(null);
    setActing(true);
    try {
      const pos = await getPosition();
      const now = new Date();
      const isLate = schedule ? timeStr(now) > schedule.jam_masuk : false;

      const { data, error } = await supabase
        .from('attendance')
        .insert([{
          employee_id: employee.id,
          tanggal: todayStr(),
          clock_in: now.toISOString(),
          clock_in_lat: pos.coords.latitude,
          clock_in_lng: pos.coords.longitude,
          status_telat: isLate,
        }])
        .select()
        .single();

      if (error) throw error;
      setTodayRow(data);
      setHistory((h) => [data, ...h.filter((r) => r.tanggal !== data.tanggal)].slice(0, 7));
    } catch (err) {
      setGeoError(err.message || 'Gagal mengambil lokasi. Pastikan izin lokasi diaktifkan.');
    } finally {
      setActing(false);
    }
  };

  const handleClockOut = async () => {
    setGeoError(null);
    setActing(true);
    try {
      const pos = await getPosition();
      const now = new Date();

      const { data, error } = await supabase
        .from('attendance')
        .update({
          clock_out: now.toISOString(),
          clock_out_lat: pos.coords.latitude,
          clock_out_lng: pos.coords.longitude,
        })
        .eq('id', todayRow.id)
        .select()
        .single();

      if (error) throw error;
      setTodayRow(data);
      setHistory((h) => h.map((r) => (r.id === data.id ? data : r)));
    } catch (err) {
      setGeoError(err.message || 'Gagal mengambil lokasi. Pastikan izin lokasi diaktifkan.');
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
      </section>
    );
  }

  const isWorkday = schedule?.hari_kerja?.includes(HARI_LABEL[new Date().getDay()]);

  return (
    <div className="max-w-[700px] mx-auto px-6 py-10">
      <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-1">Absensi</h1>
      <p className="text-sm text-[#6B6B6B] mb-8">Halo, {employee?.nama}. {formatTanggal(todayStr())}.</p>

      {!schedule && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-3 mb-6">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Jadwal kerja kamu belum diatur superadmin, jadi status telat belum bisa dihitung. Clock in/out tetap bisa dilakukan.
        </div>
      )}
      {schedule && !isWorkday && (
        <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#6B6B6B] text-xs px-4 py-3 mb-6">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Hari ini bukan hari kerja terjadwal kamu.
        </div>
      )}
      {geoError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 mb-6">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {geoError}
        </div>
      )}

      <div className="bg-white border border-[#E0E0E0] p-6 mb-8">
        {schedule && (
          <p className="text-xs text-[#9A9A9A] mb-4">
            Jadwal: {formatJam(schedule.jam_masuk)} – {formatJam(schedule.jam_pulang)}
          </p>
        )}

        {!todayRow ? (
          <>
            <p className="text-sm text-black mb-4">Kamu belum clock in hari ini.</p>
            <button
              onClick={handleClockIn}
              disabled={acting}
              className="flex items-center gap-2 bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              <MapPin size={16} />
              {acting ? 'Mengambil lokasi...' : 'Clock In'}
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-black">
              <CheckCircle2 size={16} className="text-madael-red" />
              Clock in pukul {formatWaktu(todayRow.clock_in)}
              {todayRow.status_telat && (
                <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-red-100 text-red-700">
                  TELAT
                </span>
              )}
            </div>

            {!todayRow.clock_out ? (
              <button
                onClick={handleClockOut}
                disabled={acting}
                className="flex items-center gap-2 bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
              >
                <MapPin size={16} />
                {acting ? 'Mengambil lokasi...' : 'Clock Out'}
              </button>
            ) : (
              <div className="flex items-center gap-2 text-sm text-black">
                <Clock size={16} className="text-[#9A9A9A]" />
                Clock out pukul {formatWaktu(todayRow.clock_out)} — absensi hari ini selesai.
              </div>
            )}
          </div>
        )}
      </div>

      <h2 className="text-sm font-medium text-black mb-3">Riwayat 7 Hari Terakhir</h2>
      <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
              <th className="px-4 py-3 font-medium">Tanggal</th>
              <th className="px-4 py-3 font-medium">Clock In</th>
              <th className="px-4 py-3 font-medium">Clock Out</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {history.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-xs text-[#9A9A9A]">
                  Belum ada riwayat absensi.
                </td>
              </tr>
            ) : (
              history.map((row) => (
                <tr key={row.id} className="border-b border-[#E0E0E0] last:border-0">
                  <td className="px-4 py-3 text-black">{formatTanggal(row.tanggal)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{formatWaktu(row.clock_in)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{formatWaktu(row.clock_out)}</td>
                  <td className="px-4 py-3">
                    {row.status_telat ? (
                      <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-red-100 text-red-700">
                        TELAT
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-green-100 text-green-700">
                        TEPAT WAKTU
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {employee?.is_superadmin && (
        <Link href="/employee/absensi/jadwal" className="inline-block mt-6 text-xs text-[#6B6B6B] hover:text-madael-red">
          Kelola jadwal kerja karyawan →
        </Link>
      )}
    </div>
  );
}