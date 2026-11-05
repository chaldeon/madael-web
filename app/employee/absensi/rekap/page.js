'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import { isTelatEfektif } from '@/lib/attendanceStatus';
import { friendlyError } from '@/lib/errorMessage';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { summarizeMonth, monthBounds } from '@/lib/attendanceSummary';
import { ambilLibur, liburUntukJadwal } from '@/lib/publicHolidays';
import { todayWib, currentMonthWib } from '@/lib/wibTime';

// Bikin CSV manual dari data yang sudah ditampilkan di tabel (tanpa library
// tambahan). BOM di depan supaya Excel buka karakter non-ASCII dengan benar.
function toCsvValue(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function downloadRekapCsv(rows, monthValue) {
  const header = ['Nama', 'Perusahaan', 'Total Hadir', 'Total Telat', 'Tidak Hadir', 'Cuti (hari kerja)'];
  const lines = [header.map(toCsvValue).join(',')];

  rows.forEach(({ emp, totalHadir, totalTelat, totalTidakHadir, cutiHari }) => {
    lines.push([
      emp.nama,
      emp.companies?.nama_perusahaan || '',
      totalHadir,
      totalTelat,
      totalTidakHadir === null ? '' : totalTidakHadir,
      cutiHari,
    ].map(toCsvValue).join(','));
  });

  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rekap-absensi-${monthValue}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function RekapAbsensiPage() {
  const supabase = createClient();
  const { status, employee } = useModuleAccess('absensi_admin');

  const [monthValue, setMonthValue] = useState(currentMonthWib());
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState({}); // employee_id -> row
  const [attendance, setAttendance] = useState([]);
  const [leaves, setLeaves] = useState([]); // cuti/sakit/izin approved yang beririsan dengan bulan ini
  const [libur, setLibur] = useState(() => new Map()); // hari libur nasional/cuti bersama di bulan ini
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const isSuperadmin = !!employee?.is_superadmin;

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { firstDay, lastDay } = monthBounds(monthValue);

    // Cuti disetujui dibaca lewat API server (service role), bukan dari browser.
    const leaveRequest = fetch(`/api/attendance/rekap-cuti?month=${monthValue}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        return res.ok ? { data: body.leaves || [], error: null } : { data: null, error: { message: body.error } };
      })
      .catch((err) => ({ data: null, error: err }));

    const [empRes, schedRes, attRes, leaveRes, liburRes] = await Promise.all([
      supabase
        .from('employees')
        .select('id, nama, employee_id, status, companies:client_id ( nama_perusahaan )')
        .eq('status', 'Aktif')
        .order('nama'),
      supabase.from('work_schedule').select('*'),
      // Sebulan penuh untuk semua karyawan bisa > 1.000 baris (batas max-rows
      // PostgREST), jadi diambil per halaman sampai habis.
      fetchAllRows(() =>
        supabase
          .from('attendance')
          .select('employee_id, tanggal, clock_in, status_telat, justified')
          .gte('tanggal', firstDay)
          .lte('tanggal', lastDay)
      ),
      leaveRequest,
      ambilLibur(supabase, { dari: firstDay, sampai: lastDay }),
    ]);

    // Tanpa data cuti, "Tidak Hadir" akan terlalu besar (cuti terhitung absen),
    // jadi kegagalan memuat cuti diperlakukan sebagai kegagalan memuat rekap.
    // Tanpa data libur, tanggal merah terhitung "Tidak Hadir" — sama seperti cuti.
    const firstError = empRes.error || schedRes.error || attRes.error || leaveRes.error || liburRes.error;
    if (firstError) {
      setLoadError(friendlyError(firstError, 'Gagal memuat data rekap.'));
      setLoading(false);
      return;
    }

    setEmployees(empRes.data || []);
    const byEmp = {};
    (schedRes.data || []).forEach((s) => { byEmp[s.employee_id] = s; });
    setSchedules(byEmp);
    setAttendance(attRes.data || []);
    setLeaves(leaveRes.data || []);
    setLibur(liburRes.libur);
    setLoading(false);
  }, [supabase, monthValue]);

  useEffect(() => {
    if (status === 'allowed' && isSuperadmin) loadData();
  }, [status, isSuperadmin, loadData]);

  const rows = useMemo(() => {
    // Aturan hitung sama dengan "Absensi Saya" (summarizeMonth): hari ini belum
    // dihitung tidak hadir, dan hari kerja yang tertutup cuti/sakit/izin
    // disetujui dihitung cuti, bukan tidak hadir. "Hari ini" menurut WIB.
    const today = todayWib();

    const attByEmp = new Map();
    attendance.forEach((a) => {
      if (!attByEmp.has(a.employee_id)) attByEmp.set(a.employee_id, []);
      attByEmp.get(a.employee_id).push(a);
    });
    const leaveByEmp = new Map();
    leaves.forEach((l) => {
      if (!leaveByEmp.has(l.employee_id)) leaveByEmp.set(l.employee_id, []);
      leaveByEmp.get(l.employee_id).push(l);
    });

    const list = employeeFilter === 'all'
      ? employees
      : employees.filter((e) => e.id === employeeFilter);

    return list.map((emp) => {
      const summary = summarizeMonth({
        monthValue,
        rows: attByEmp.get(emp.id) || [],
        leaves: leaveByEmp.get(emp.id) || [],
        hariKerja: schedules[emp.id]?.hari_kerja || null,
        today,
        libur: liburUntukJadwal(libur, schedules[emp.id]),
      });
      return {
        emp,
        totalHadir: summary.totalHadir,
        totalTelat: summary.totalTelat,
        totalTidakHadir: summary.totalTidakHadir, // null = jadwal belum diatur
        cutiHari: summary.cutiHari,
      };
    });
  }, [employees, attendance, leaves, libur, schedules, employeeFilter, monthValue]);

  if (status === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat data..." />
      </section>
    );
  }

  if (status === 'denied' || !isSuperadmin) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Halaman ini khusus superadmin.</p>
          <Link
            href="/employee/absensi"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali
          </Link>
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px]">
          <ErrorState message={loadError} onRetry={loadData} />
        </div>
      </section>
    );
  }

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Rekap Bulanan</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">Rekap kehadiran per employee per bulan.</p>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <input
          type="month"
          value={monthValue}
          onChange={(e) => setMonthValue(e.target.value)}
          className={selectClass}
        />
        <select
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          className={selectClass}
        >
          <option value="all">Semua Karyawan</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.nama}</option>
          ))}
        </select>
        <button
          onClick={() => downloadRekapCsv(rows, monthValue)}
          disabled={loading || rows.length === 0}
          className="bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
        >
          Export ke CSV
        </button>
      </div>

      <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#6B6B6B] text-xs px-4 py-3 mb-6">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        Kolom "Tidak Hadir" dihitung dari jadwal kerja yang sudah diatur (halaman Jadwal Kerja),
        tidak termasuk hari ini dan hari kerja yang tertutup cuti, sakit, atau izin yang sudah disetujui
        (kolom "Cuti"), serta hari libur nasional dan cuti bersama (diatur superadmin di menu Hari Libur;
        karyawan yang jadwalnya ditandai bekerja di hari libur tetap dihitung). Employee tanpa jadwal
        akan tampil "—" karena hari kerjanya belum diketahui.
      </div>

      {loading ? (
        <LoadingState label="Memuat rekap..." />
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Nama</th>
                <th className="px-4 py-3 font-medium">Perusahaan</th>
                <th className="px-4 py-3 font-medium">Total Hadir</th>
                <th className="px-4 py-3 font-medium">Total Telat</th>
                <th className="px-4 py-3 font-medium">Tidak Hadir</th>
                <th className="px-4 py-3 font-medium">Cuti</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState message="Tidak ada data karyawan untuk bulan atau filter ini." />
                  </td>
                </tr>
              ) : (
                rows.map(({ emp, totalHadir, totalTelat, totalTidakHadir, cutiHari }) => (
                  <tr key={emp.id} className="border-b border-[#E0E0E0] last:border-0">
                    <td className="px-4 py-3 text-black">{emp.nama}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{emp.companies?.nama_perusahaan || '—'}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{totalHadir}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{totalTelat}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">
                      {totalTidakHadir === null ? '—' : totalTidakHadir}
                    </td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{cutiHari}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/employee/absensi/rekap/${emp.id}?month=${monthValue}`}
                        className="text-xs text-madael-red hover:text-madael-dark font-medium"
                      >
                        Detail →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}