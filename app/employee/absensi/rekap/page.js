'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';

const HARI_LABEL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Hitung jumlah hari kerja terjadwal dalam sebuah bulan, dibatasi sampai
// tanggal cutoff (hari ini, kalau bulan yang dipilih adalah bulan berjalan)
// supaya sisa hari yang belum terjadi tidak ikut dihitung sebagai "tidak hadir".
function countScheduledWorkdays(year, month, hariKerja, cutoffDate) {
  if (!hariKerja?.length) return 0;
  const lastDay = new Date(year, month, 0).getDate();
  const cutoff = cutoffDate < lastDay ? cutoffDate : lastDay;
  let count = 0;
  for (let day = 1; day <= cutoff; day++) {
    const date = new Date(year, month - 1, day);
    if (hariKerja.includes(HARI_LABEL[date.getDay()])) count++;
  }
  return count;
}

export default function RekapAbsensiPage() {
  const supabase = createClient();
  const { status, employee } = useModuleAccess('absensi');

  const [monthValue, setMonthValue] = useState(currentMonthValue());
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState({}); // employee_id -> row
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);

  const isSuperadmin = !!employee?.is_superadmin;

  const loadData = useCallback(async () => {
    setLoading(true);
    const [year, month] = monthValue.split('-').map(Number);
    const firstDay = `${monthValue}-01`;
    const lastDayNum = new Date(year, month, 0).getDate();
    const lastDay = `${monthValue}-${String(lastDayNum).padStart(2, '0')}`;

    const [{ data: emps }, { data: scheds }, { data: att }] = await Promise.all([
      supabase
        .from('employees')
        .select('id, nama, employee_id, perusahaan, status')
        .eq('status', 'Aktif')
        .order('nama'),
      supabase.from('work_schedule').select('*'),
      supabase
        .from('attendance')
        .select('employee_id, tanggal, clock_in, status_telat')
        .gte('tanggal', firstDay)
        .lte('tanggal', lastDay),
    ]);

    setEmployees(emps || []);
    const byEmp = {};
    (scheds || []).forEach((s) => { byEmp[s.employee_id] = s; });
    setSchedules(byEmp);
    setAttendance(att || []);
    setLoading(false);
  }, [supabase, monthValue]);

  useEffect(() => {
    if (status === 'allowed' && isSuperadmin) loadData();
  }, [status, isSuperadmin, loadData]);

  const rows = useMemo(() => {
    const [year, month] = monthValue.split('-').map(Number);
    const isCurrentMonth = monthValue === currentMonthValue();
    const cutoffDate = isCurrentMonth ? new Date().getDate() : new Date(year, month, 0).getDate();

    const list = employeeFilter === 'all'
      ? employees
      : employees.filter((e) => e.id === employeeFilter);

    return list.map((emp) => {
      const empAtt = attendance.filter((a) => a.employee_id === emp.id);
      const totalHadir = empAtt.filter((a) => a.clock_in).length;
      const totalTelat = empAtt.filter((a) => a.status_telat).length;

      const sched = schedules[emp.id];
      const scheduledWorkdays = sched
        ? countScheduledWorkdays(year, month, sched.hari_kerja, cutoffDate)
        : null;
      const totalTidakHadir = scheduledWorkdays === null
        ? null
        : Math.max(0, scheduledWorkdays - totalHadir);

      return { emp, totalHadir, totalTelat, totalTidakHadir };
    });
  }, [employees, attendance, schedules, employeeFilter, monthValue]);

  if (status === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
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

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Rekap Bulanan</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">Rekap kehadiran per employee per bulan.</p>
        </div>
        <Link href="/employee/absensi" className="text-sm text-[#6B6B6B] hover:text-madael-red">
          ← Absensi
        </Link>
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
      </div>

      <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#6B6B6B] text-xs px-4 py-3 mb-6">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        Kolom "Tidak Hadir" dihitung dari jadwal kerja yang sudah diatur (halaman Jadwal Kerja).
        Employee tanpa jadwal akan tampil "—" karena hari kerjanya belum diketahui.
      </div>

      {loading ? (
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
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
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-xs text-[#9A9A9A]">
                    Tidak ada data untuk bulan ini.
                  </td>
                </tr>
              ) : (
                rows.map(({ emp, totalHadir, totalTelat, totalTidakHadir }) => (
                  <tr key={emp.id} className="border-b border-[#E0E0E0] last:border-0">
                    <td className="px-4 py-3 text-black">{emp.nama}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{emp.perusahaan || '—'}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{totalHadir}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{totalTelat}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">
                      {totalTidakHadir === null ? '—' : totalTidakHadir}
                    </td>
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