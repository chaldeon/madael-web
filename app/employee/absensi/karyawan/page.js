'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowUp, ArrowDown, ArrowUpDown, Pencil, X, AlertTriangle,
  ExternalLink, Check, XCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { logActivity } from '@/lib/activityLog';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

const HARI_LABEL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const HARI_OPTIONS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const DEFAULT_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
const EMPTY_JADWAL_FORM = { jam_masuk: '08:00', jam_pulang: '17:00', hari_kerja: DEFAULT_HARI };

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatJam(value) {
  return value ? value.slice(0, 5) : '—';
}

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatWaktu(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

// Hitung jumlah hari kerja terjadwal dalam sebuah bulan, dibatasi sampai
// tanggal cutoff (hari ini, kalau bulan yang dipilih adalah bulan berjalan).
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

function toCsvValue(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function downloadRekapCsv(rows, monthValue) {
  const header = ['Nama', 'Perusahaan', 'Total Hadir', 'Total Telat', 'Tidak Hadir'];
  const lines = [header.map(toCsvValue).join(',')];
  rows.forEach(({ emp, totalHadir, totalTelat, totalTidakHadir }) => {
    lines.push([
      emp.nama,
      emp.companies?.nama_perusahaan || '',
      totalHadir,
      totalTelat,
      totalTidakHadir === null ? '' : totalTidakHadir,
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

// Cocokkan jam clock-in (ISO) terhadap jadwal, untuk menentukan status telat
// saat approve koreksi (jadwal employee mungkin belum di-load di tab lain).
function computeStatusTelat(afterClockInIso, schedule) {
  if (!schedule || !afterClockInIso) return false;
  const t = new Date(afterClockInIso).toTimeString().slice(0, 8);
  return t > schedule.jam_masuk;
}

const JADWAL_SORT_COLUMNS = {
  nama: { label: 'Nama', get: (r) => (r.emp.nama || '').toLowerCase() },
  perusahaan: { label: 'Perusahaan', get: (r) => (r.emp.companies?.nama_perusahaan || '').toLowerCase() },
  jam_masuk: { label: 'Jam Masuk', get: (r) => r.sched?.jam_masuk || '' },
  jam_pulang: { label: 'Jam Pulang', get: (r) => r.sched?.jam_pulang || '' },
};

function SortableHeader({ colKey, label, sortField, sortDir, onSort }) {
  const active = sortField === colKey;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className="px-4 py-3 font-medium">
      <button
        type="button"
        onClick={() => onSort(colKey)}
        className={`flex items-center gap-1.5 hover:text-black transition-colors ${active ? 'text-black' : ''}`}
      >
        {label}
        <Icon size={12} className={active ? 'text-madael-red' : 'text-[#B0B0B0]'} />
      </button>
    </th>
  );
}

const TABS = [
  { key: 'jadwal', label: 'Jadwal Kerja' },
  { key: 'rekap', label: 'Rekap Bulanan' },
  { key: 'koreksi', label: 'Approval Koreksi' },
];

export default function SemuaKaryawanPage() {
  const supabase = createClient();
  const { status, employee } = useModuleAccess('absensi');
  const isSuperadmin = !!employee?.is_superadmin;

  const [activeTab, setActiveTab] = useState('koreksi');

  const [employees, setEmployees] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [schedules, setSchedules] = useState({}); // employee_id -> work_schedule row
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // ---- Jadwal Kerja ----
  const [jadwalSortField, setJadwalSortField] = useState('nama');
  const [jadwalSortDir, setJadwalSortDir] = useState('asc');
  const [jadwalFilterClientId, setJadwalFilterClientId] = useState('');
  const [editingEmp, setEditingEmp] = useState(null);
  const [jadwalForm, setJadwalForm] = useState(EMPTY_JADWAL_FORM);
  const [jadwalSaving, setJadwalSaving] = useState(false);
  const [jadwalSaveError, setJadwalSaveError] = useState(null);

  // ---- Rekap Bulanan ----
  const [monthValue, setMonthValue] = useState(currentMonthValue());
  const [rekapEmployeeFilter, setRekapEmployeeFilter] = useState('all');
  const [attendance, setAttendance] = useState([]);
  const [rekapLoading, setRekapLoading] = useState(false);
  const [rekapError, setRekapError] = useState(null);
  const [rekapLoadedMonth, setRekapLoadedMonth] = useState(null);

  // ---- Approval Koreksi ----
  const [koreksiStatusFilter, setKoreksiStatusFilter] = useState('pending');
  const [corrections, setCorrections] = useState([]);
  const [koreksiLoading, setKoreksiLoading] = useState(false);
  const [koreksiError, setKoreksiError] = useState(null);
  const [processingId, setProcessingId] = useState(null);
  const [rejectingRow, setRejectingRow] = useState(null);
  const [rejectCatatan, setRejectCatatan] = useState('');

  // Employees + schedules dipakai bareng oleh tab Jadwal & Rekap, jadi
  // di-load sekali di awal.
  const loadBase = useCallback(async () => {
    setLoadingBase(true);
    setLoadError(null);
    const [empRes, schedRes] = await Promise.all([
      supabase
        .from('employees')
        .select('id, nama, employee_id, status, client_id, companies:client_id ( nama_perusahaan )')
        .eq('status', 'Aktif')
        .order('nama'),
      supabase.from('work_schedule').select('*'),
    ]);

    const firstError = empRes.error || schedRes.error;
    if (firstError) {
      setLoadError(firstError.message || 'Gagal memuat data karyawan.');
      setLoadingBase(false);
      return;
    }

    setEmployees(empRes.data || []);
    const companyMap = new Map();
    (empRes.data || []).forEach((e) => {
      if (e.client_id && e.companies?.nama_perusahaan) {
        companyMap.set(e.client_id, e.companies.nama_perusahaan);
      }
    });
    setCompanies(Array.from(companyMap, ([id, nama]) => ({ id, nama })));
    const byEmp = {};
    (schedRes.data || []).forEach((s) => { byEmp[s.employee_id] = s; });
    setSchedules(byEmp);
    setLoadingBase(false);
  }, [supabase]);

  useEffect(() => {
    if (status === 'allowed' && isSuperadmin) loadBase();
  }, [status, isSuperadmin, loadBase]);

  // ---- Rekap: load per bulan, cuma saat tab rekap aktif ----
  const loadRekap = useCallback(async () => {
    setRekapLoading(true);
    setRekapError(null);
    const [year, month] = monthValue.split('-').map(Number);
    const firstDay = `${monthValue}-01`;
    const lastDayNum = new Date(year, month, 0).getDate();
    const lastDay = `${monthValue}-${String(lastDayNum).padStart(2, '0')}`;

    const { data, error } = await supabase
      .from('attendance')
      .select('employee_id, tanggal, clock_in, status_telat')
      .gte('tanggal', firstDay)
      .lte('tanggal', lastDay);

    setRekapLoading(false);
    if (error) {
      setRekapError(error.message || 'Gagal memuat data rekap.');
      return;
    }
    setAttendance(data || []);
    setRekapLoadedMonth(monthValue);
  }, [supabase, monthValue]);

  useEffect(() => {
    if (activeTab === 'rekap' && isSuperadmin && rekapLoadedMonth !== monthValue) {
      loadRekap();
    }
  }, [activeTab, isSuperadmin, monthValue, rekapLoadedMonth, loadRekap]);

  // ---- Approval Koreksi: load sesuai filter status ----
  const loadKoreksi = useCallback(async () => {
    setKoreksiLoading(true);
    setKoreksiError(null);
    let query = supabase
      .from('attendance_corrections')
      .select('*, employees:employee_id ( nama )')
      .not('requested_by', 'is', null) // hanya pengajuan mandiri karyawan, bukan koreksi manual lama admin
      .order('created_at', { ascending: false })
      .limit(100);

    if (koreksiStatusFilter !== 'all') {
      query = query.eq('status', koreksiStatusFilter);
    }

    const { data, error } = await query;
    setKoreksiLoading(false);
    if (error) {
      setKoreksiError(error.message || 'Gagal memuat pengajuan koreksi.');
      return;
    }
    setCorrections(data || []);
  }, [supabase, koreksiStatusFilter]);

  useEffect(() => {
    if (activeTab === 'koreksi' && isSuperadmin) loadKoreksi();
  }, [activeTab, isSuperadmin, koreksiStatusFilter, loadKoreksi]);

  // ---- Jadwal handlers ----
  const jadwalRows = useMemo(() => {
    let rows = employees.map((emp) => ({ emp, sched: schedules[emp.id] }));
    if (jadwalFilterClientId) {
      rows = rows.filter((r) => r.emp.client_id === jadwalFilterClientId);
    }
    const getValue = JADWAL_SORT_COLUMNS[jadwalSortField]?.get;
    if (!getValue) return rows;
    const sorted = [...rows].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return jadwalSortDir === 'desc' ? sorted.reverse() : sorted;
  }, [employees, schedules, jadwalFilterClientId, jadwalSortField, jadwalSortDir]);

  const handleJadwalSort = (colKey) => {
    if (jadwalSortField === colKey) {
      setJadwalSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setJadwalSortField(colKey);
      setJadwalSortDir('asc');
    }
  };

  const openEditJadwal = (emp) => {
    const existing = schedules[emp.id];
    setJadwalForm(existing
      ? { jam_masuk: formatJam(existing.jam_masuk), jam_pulang: formatJam(existing.jam_pulang), hari_kerja: existing.hari_kerja || DEFAULT_HARI }
      : EMPTY_JADWAL_FORM);
    setJadwalSaveError(null);
    setEditingEmp(emp);
  };

  const toggleHari = (hari) => {
    setJadwalForm((f) => ({
      ...f,
      hari_kerja: f.hari_kerja.includes(hari)
        ? f.hari_kerja.filter((h) => h !== hari)
        : [...f.hari_kerja, hari],
    }));
  };

  const handleSaveJadwal = async () => {
    setJadwalSaving(true);
    setJadwalSaveError(null);
    const { data, error } = await supabase
      .from('work_schedule')
      .upsert(
        [{
          employee_id: editingEmp.id,
          jam_masuk: jadwalForm.jam_masuk,
          jam_pulang: jadwalForm.jam_pulang,
          hari_kerja: jadwalForm.hari_kerja,
        }],
        { onConflict: 'employee_id' }
      )
      .select()
      .single();

    setJadwalSaving(false);
    if (error) {
      setJadwalSaveError(error.message || 'Gagal menyimpan jadwal, coba lagi.');
      return;
    }
    setSchedules((s) => ({ ...s, [editingEmp.id]: data }));
    setEditingEmp(null);
  };

  // ---- Rekap computed rows ----
  const rekapRows = useMemo(() => {
    const [year, month] = monthValue.split('-').map(Number);
    const isCurrentMonth = monthValue === currentMonthValue();
    const cutoffDate = isCurrentMonth ? new Date().getDate() : new Date(year, month, 0).getDate();

    const list = rekapEmployeeFilter === 'all'
      ? employees
      : employees.filter((e) => e.id === rekapEmployeeFilter);

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
  }, [employees, attendance, schedules, rekapEmployeeFilter, monthValue]);

  // ---- Approval Koreksi handlers ----
  const handleApproveKoreksi = async (row) => {
    setProcessingId(row.id);
    setKoreksiError(null);
    try {
      const schedule = schedules[row.employee_id];
      const statusTelat = computeStatusTelat(row.after_clock_in, schedule);

      let attendanceId = row.attendance_id;
      if (attendanceId) {
        const { data, error } = await supabase
          .from('attendance')
          .update({
            clock_in: row.after_clock_in,
            clock_out: row.after_clock_out,
            status_telat: statusTelat,
            wajah_terverifikasi: true,
          })
          .eq('id', attendanceId)
          .select()
          .single();
        if (error) throw error;
        attendanceId = data.id;
      } else {
        const { data, error } = await supabase
          .from('attendance')
          .insert([{
            employee_id: row.employee_id,
            tanggal: row.tanggal,
            clock_in: row.after_clock_in,
            clock_out: row.after_clock_out,
            status_telat: statusTelat,
            wajah_terverifikasi: true,
          }])
          .select()
          .single();
        if (error) throw error;
        attendanceId = data.id;
      }

      const { error: updateError } = await supabase
        .from('attendance_corrections')
        .update({
          status: 'approved',
          reviewed_by: employee.id,
          reviewed_at: new Date().toISOString(),
          corrected_by: employee.id,
          attendance_id: attendanceId,
        })
        .eq('id', row.id);
      if (updateError) throw updateError;

      setCorrections((prev) =>
        koreksiStatusFilter === 'all'
          ? prev.map((r) => (r.id === row.id ? { ...r, status: 'approved', attendance_id: attendanceId } : r))
          : prev.filter((r) => r.id !== row.id)
      );

      logActivity(supabase, {
        userId: employee.id,
        aksi: 'approve_koreksi_absensi',
        targetTable: 'attendance_corrections',
        targetId: row.id,
        detail: { employee_id: row.employee_id, tanggal: row.tanggal },
      });
    } catch (err) {
      setKoreksiError(err.message || 'Gagal menyetujui pengajuan koreksi.');
    } finally {
      setProcessingId(null);
    }
  };

  const openReject = (row) => {
    setRejectCatatan('');
    setRejectingRow(row);
  };

  const handleConfirmReject = async () => {
    if (!rejectingRow) return;
    setProcessingId(rejectingRow.id);
    setKoreksiError(null);
    try {
      const { error } = await supabase
        .from('attendance_corrections')
        .update({
          status: 'rejected',
          reviewed_by: employee.id,
          reviewed_at: new Date().toISOString(),
          catatan_reviewer: rejectCatatan.trim() || null,
        })
        .eq('id', rejectingRow.id);
      if (error) throw error;

      setCorrections((prev) =>
        koreksiStatusFilter === 'all'
          ? prev.map((r) => (r.id === rejectingRow.id ? { ...r, status: 'rejected', catatan_reviewer: rejectCatatan.trim() || null } : r))
          : prev.filter((r) => r.id !== rejectingRow.id)
      );

      logActivity(supabase, {
        userId: employee.id,
        aksi: 'reject_koreksi_absensi',
        targetTable: 'attendance_corrections',
        targetId: rejectingRow.id,
        detail: { employee_id: rejectingRow.employee_id, tanggal: rejectingRow.tanggal, catatan: rejectCatatan.trim() || null },
      });
      setRejectingRow(null);
    } catch (err) {
      setKoreksiError(err.message || 'Gagal menolak pengajuan koreksi.');
    } finally {
      setProcessingId(null);
    }
  };

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
          <ErrorState message={loadError} onRetry={loadBase} />
        </div>
      </section>
    );
  }

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const inputClass = selectClass;
  const pendingCount = koreksiStatusFilter === 'pending' ? corrections.length : corrections.filter((c) => c.status === 'pending').length;

  return (
    <div className="max-w-[960px] mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Semua Karyawan</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">Jadwal kerja, rekap kehadiran, dan approval koreksi absensi.</p>
      </div>

      <div className="flex items-center gap-6 border-b border-[#E0E0E0] mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`relative pb-3 text-sm tracking-[0.02em] transition-colors ${
              activeTab === tab.key ? 'text-black font-medium' : 'text-[#6B6B6B] hover:text-black'
            }`}
          >
            {tab.label}
            {tab.key === 'koreksi' && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 bg-madael-red text-white text-[10px] rounded-full align-middle">
                {pendingCount}
              </span>
            )}
            {activeTab === tab.key && (
              <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-madael-red" />
            )}
          </button>
        ))}
      </div>

      {loadingBase ? (
        <LoadingState label="Memuat data karyawan..." />
      ) : (
        <>
          {activeTab === 'jadwal' && (
            <div>
              <div className="flex flex-wrap gap-3 mb-6">
                <select
                  value={jadwalFilterClientId}
                  onChange={(e) => setJadwalFilterClientId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Semua Perusahaan</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.nama}</option>
                  ))}
                </select>
              </div>

              {jadwalRows.length === 0 ? (
                <div className="bg-white border border-[#E0E0E0]">
                  <EmptyState message="Tidak ada employee yang cocok dengan filter ini." />
                </div>
              ) : (
                <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                        <SortableHeader colKey="nama" label="Nama" sortField={jadwalSortField} sortDir={jadwalSortDir} onSort={handleJadwalSort} />
                        <SortableHeader colKey="perusahaan" label="Perusahaan" sortField={jadwalSortField} sortDir={jadwalSortDir} onSort={handleJadwalSort} />
                        <SortableHeader colKey="jam_masuk" label="Jam Masuk" sortField={jadwalSortField} sortDir={jadwalSortDir} onSort={handleJadwalSort} />
                        <SortableHeader colKey="jam_pulang" label="Jam Pulang" sortField={jadwalSortField} sortDir={jadwalSortDir} onSort={handleJadwalSort} />
                        <th className="px-4 py-3 font-medium">Hari Kerja</th>
                        <th className="px-4 py-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {jadwalRows.map(({ emp, sched }) => (
                        <tr key={emp.id} className="border-b border-[#E0E0E0] last:border-0">
                          <td className="px-4 py-3 text-black">{emp.nama}</td>
                          <td className="px-4 py-3 text-[#6B6B6B]">{emp.companies?.nama_perusahaan || '—'}</td>
                          <td className="px-4 py-3 text-[#6B6B6B]">{sched ? formatJam(sched.jam_masuk) : '—'}</td>
                          <td className="px-4 py-3 text-[#6B6B6B]">{sched ? formatJam(sched.jam_pulang) : '—'}</td>
                          <td className="px-4 py-3 text-[#6B6B6B]">
                            {sched?.hari_kerja?.length ? sched.hari_kerja.join(', ') : 'Belum diatur'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => openEditJadwal(emp)}
                              className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium"
                            >
                              <Pencil size={12} />
                              Edit
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'rekap' && (
            <div>
              <div className="flex flex-wrap gap-3 mb-6">
                <input
                  type="month"
                  value={monthValue}
                  onChange={(e) => setMonthValue(e.target.value)}
                  className={selectClass}
                />
                <select
                  value={rekapEmployeeFilter}
                  onChange={(e) => setRekapEmployeeFilter(e.target.value)}
                  className={selectClass}
                >
                  <option value="all">Semua Karyawan</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.nama}</option>
                  ))}
                </select>
                <button
                  onClick={() => downloadRekapCsv(rekapRows, monthValue)}
                  disabled={rekapLoading || rekapRows.length === 0}
                  className="bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
                >
                  Export ke CSV
                </button>
              </div>

              <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#6B6B6B] text-xs px-4 py-3 mb-6">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                Kolom "Tidak Hadir" dihitung dari jadwal kerja yang sudah diatur di tab Jadwal Kerja.
                Employee tanpa jadwal akan tampil "—".
              </div>

              {rekapError && (
                <div className="mb-6">
                  <ErrorState message={rekapError} onRetry={loadRekap} />
                </div>
              )}

              {rekapLoading ? (
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
                        <th className="px-4 py-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rekapRows.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <EmptyState message="Tidak ada data karyawan untuk bulan atau filter ini." />
                          </td>
                        </tr>
                      ) : (
                        rekapRows.map(({ emp, totalHadir, totalTelat, totalTidakHadir }) => (
                          <tr key={emp.id} className="border-b border-[#E0E0E0] last:border-0">
                            <td className="px-4 py-3 text-black">{emp.nama}</td>
                            <td className="px-4 py-3 text-[#6B6B6B]">{emp.companies?.nama_perusahaan || '—'}</td>
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
          )}

          {activeTab === 'koreksi' && (
            <div>
              <div className="flex flex-wrap gap-3 mb-6">
                <select
                  value={koreksiStatusFilter}
                  onChange={(e) => setKoreksiStatusFilter(e.target.value)}
                  className={selectClass}
                >
                  <option value="pending">Menunggu Approval</option>
                  <option value="approved">Disetujui</option>
                  <option value="rejected">Ditolak</option>
                  <option value="all">Semua</option>
                </select>
              </div>

              {koreksiError && (
                <div className="mb-6">
                  <ErrorState message={koreksiError} onRetry={loadKoreksi} />
                </div>
              )}

              {koreksiLoading ? (
                <LoadingState label="Memuat pengajuan koreksi..." />
              ) : corrections.length === 0 ? (
                <div className="bg-white border border-[#E0E0E0]">
                  <EmptyState message="Tidak ada pengajuan koreksi untuk filter ini." />
                </div>
              ) : (
                <div className="space-y-3">
                  {corrections.map((row) => (
                    <div key={row.id} className="bg-white border border-[#E0E0E0] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                        <div>
                          <p className="text-sm font-medium text-black">{row.employees?.nama || '—'}</p>
                          <p className="text-xs text-[#9A9A9A]">{formatTanggal(row.tanggal)}</p>
                        </div>
                        {row.status === 'pending' && (
                          <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-amber-100 text-amber-700 shrink-0">
                            MENUNGGU
                          </span>
                        )}
                        {row.status === 'approved' && (
                          <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-green-100 text-green-700 shrink-0">
                            DISETUJUI
                          </span>
                        )}
                        {row.status === 'rejected' && (
                          <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-red-100 text-red-700 shrink-0">
                            DITOLAK
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs mb-3">
                        <div className="bg-[#F4F4F4] px-3 py-2">
                          <p className="text-[#9A9A9A] mb-0.5">Sebelum</p>
                          <p className="text-black">
                            Masuk {formatWaktu(row.before_clock_in)} — Pulang {formatWaktu(row.before_clock_out)}
                          </p>
                        </div>
                        <div className="bg-[#F4F4F4] px-3 py-2">
                          <p className="text-[#9A9A9A] mb-0.5">Diajukan</p>
                          <p className="text-black">
                            Masuk {formatWaktu(row.after_clock_in)} — Pulang {formatWaktu(row.after_clock_out)}
                          </p>
                        </div>
                      </div>

                      <p className="text-xs text-[#6B6B6B] mb-3">
                        <span className="text-[#9A9A9A]">Alasan: </span>{row.alasan}
                      </p>

                      {row.catatan_reviewer && (
                        <p className="text-xs text-[#6B6B6B] mb-3">
                          <span className="text-[#9A9A9A]">Catatan reviewer: </span>{row.catatan_reviewer}
                        </p>
                      )}

                      <div className="flex items-center justify-between gap-3">
                        {row.foto_bukti_url ? (
                          <a
                            href={row.foto_bukti_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium"
                          >
                            Lihat Bukti <ExternalLink size={12} />
                          </a>
                        ) : (
                          <span className="text-xs text-[#9A9A9A]">Tidak ada bukti</span>
                        )}

                        {row.status === 'pending' && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openReject(row)}
                              disabled={processingId === row.id}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#6B6B6B] hover:text-red-700 px-3 py-1.5 border border-[#E0E0E0] disabled:opacity-50"
                            >
                              <XCircle size={13} />
                              Tolak
                            </button>
                            <button
                              onClick={() => handleApproveKoreksi(row)}
                              disabled={processingId === row.id}
                              className="inline-flex items-center gap-1 text-xs font-medium text-white bg-madael-red hover:bg-madael-dark px-3 py-1.5 disabled:opacity-50"
                            >
                              <Check size={13} />
                              {processingId === row.id ? 'Memproses...' : 'Setujui'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {editingEmp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6">
          <div className="bg-white w-full max-w-[440px] p-6 relative">
            <button
              onClick={() => setEditingEmp(null)}
              className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black"
            >
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-4">Jadwal — {editingEmp.nama}</h2>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Jam Masuk</span>
                <input
                  type="time"
                  value={jadwalForm.jam_masuk}
                  onChange={(e) => setJadwalForm((f) => ({ ...f, jam_masuk: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Jam Pulang</span>
                <input
                  type="time"
                  value={jadwalForm.jam_pulang}
                  onChange={(e) => setJadwalForm((f) => ({ ...f, jam_pulang: e.target.value }))}
                  className={inputClass}
                />
              </label>
            </div>

            <span className="text-xs text-[#6B6B6B] block mb-2">Hari Kerja</span>
            <div className="flex flex-wrap gap-2 mb-6">
              {HARI_OPTIONS.map((hari) => {
                const active = jadwalForm.hari_kerja.includes(hari);
                return (
                  <button
                    key={hari}
                    type="button"
                    onClick={() => toggleHari(hari)}
                    className={`px-3 py-1.5 text-xs border transition-colors ${
                      active
                        ? 'bg-madael-red text-white border-madael-red'
                        : 'bg-white text-[#6B6B6B] border-[#E0E0E0]'
                    }`}
                  >
                    {hari}
                  </button>
                );
              })}
            </div>

            {jadwalSaveError && (
              <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 mb-3">
                <span>{jadwalSaveError}</span>
                <button onClick={handleSaveJadwal} className="shrink-0 underline font-medium hover:text-red-900">
                  Coba Lagi
                </button>
              </div>
            )}
            <button
              onClick={handleSaveJadwal}
              disabled={jadwalSaving}
              className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {jadwalSaving ? 'Menyimpan...' : 'Simpan Jadwal'}
            </button>
          </div>
        </div>
      )}

      {rejectingRow && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6">
          <div className="bg-white w-full max-w-[420px] p-6 relative">
            <button
              onClick={() => setRejectingRow(null)}
              className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black"
            >
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-1">
              Tolak Pengajuan — {rejectingRow.employees?.nama}
            </h2>
            <p className="text-xs text-[#9A9A9A] mb-4">{formatTanggal(rejectingRow.tanggal)}</p>

            <label className="flex flex-col gap-1 mb-5">
              <span className="text-xs text-[#6B6B6B]">Catatan untuk karyawan (opsional)</span>
              <textarea
                value={rejectCatatan}
                onChange={(e) => setRejectCatatan(e.target.value)}
                rows={3}
                placeholder="Contoh: foto bukti tidak jelas / tidak sesuai tanggal yang diajukan"
                className={`${inputClass} resize-none`}
              />
            </label>

            <button
              onClick={handleConfirmReject}
              disabled={processingId === rejectingRow.id}
              className="w-full bg-[#6B6B6B] text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-black transition-colors disabled:opacity-50"
            >
              {processingId === rejectingRow.id ? 'Memproses...' : 'Konfirmasi Tolak'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}