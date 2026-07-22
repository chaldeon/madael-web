'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle, Pencil, X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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

// Ambil jam HH:MM dari timestamptz untuk ditampilkan di <input type="time">.
// Dipakai jam lokal browser, konsisten dengan cara halaman absensi karyawan
// menyimpan clock_in/clock_out (new Date().toISOString()).
function isoToTimeInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Gabungkan tanggal record (YYYY-MM-DD) dengan jam hasil input manual admin,
// jadi timestamptz utuh. Kalau time kosong, hasilnya null (dianggap belum ada).
function timeInputToIso(tanggal, timeValue) {
  if (!timeValue) return null;
  const d = new Date(`${tanggal}T${timeValue}:00`);
  return d.toISOString();
}

export default function KoreksiAbsensiPage() {
  const supabase = createClient();
  const { status, employee } = useModuleAccess('absensi');
  const isSuperadmin = !!employee?.is_superadmin;

  const [monthValue, setMonthValue] = useState(currentMonthValue());
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [onlyBermasalah, setOnlyBermasalah] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [editingRow, setEditingRow] = useState(null);
  const [form, setForm] = useState({ clockIn: '', clockOut: '', statusTelat: false, alasan: '' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [year, month] = monthValue.split('-').map(Number);
    const firstDay = `${monthValue}-01`;
    const lastDayNum = new Date(year, month, 0).getDate();
    const lastDay = `${monthValue}-${String(lastDayNum).padStart(2, '0')}`;

    const [empRes, attRes] = await Promise.all([
      supabase
        .from('employees')
        .select('id, nama, employee_id, perusahaan, status')
        .eq('status', 'Aktif')
        .order('nama'),
      supabase
        .from('attendance')
        .select('*')
        .gte('tanggal', firstDay)
        .lte('tanggal', lastDay)
        .order('tanggal', { ascending: false }),
    ]);

    const firstError = empRes.error || attRes.error;
    if (firstError) {
      setLoadError(firstError.message || 'Gagal memuat data absensi.');
      setLoading(false);
      return;
    }

    setEmployees(empRes.data || []);
    setAttendance(attRes.data || []);
    setLoading(false);
  }, [supabase, monthValue]);

  useEffect(() => {
    if (status === 'allowed' && isSuperadmin) loadData();
  }, [status, isSuperadmin, loadData]);

  const empById = useMemo(() => {
    const map = {};
    employees.forEach((e) => { map[e.id] = e; });
    return map;
  }, [employees]);

  const rows = useMemo(() => {
    let list = attendance;
    if (employeeFilter !== 'all') {
      list = list.filter((a) => a.employee_id === employeeFilter);
    }
    if (onlyBermasalah) {
      list = list.filter((a) => !a.clock_out || !a.wajah_terverifikasi);
    }
    return list;
  }, [attendance, employeeFilter, onlyBermasalah]);

  const openEdit = (row) => {
    setSaveError(null);
    setForm({
      clockIn: isoToTimeInput(row.clock_in),
      clockOut: isoToTimeInput(row.clock_out),
      statusTelat: !!row.status_telat,
      alasan: '',
    });
    setEditingRow(row);
  };

  const closeEdit = () => {
    setEditingRow(null);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!form.alasan.trim()) {
      setSaveError('Alasan koreksi wajib diisi.');
      return;
    }

    setSaving(true);
    setSaveError(null);

    const newClockIn = timeInputToIso(editingRow.tanggal, form.clockIn);
    const newClockOut = timeInputToIso(editingRow.tanggal, form.clockOut);

    // Simpan jejak koreksi dulu (nilai sebelum & sesudah) sebelum meng-update
    // record aslinya, supaya tidak ada perubahan yang overwrite tanpa jejak.
    const { error: logError } = await supabase.from('attendance_corrections').insert([{
      attendance_id: editingRow.id,
      employee_id: editingRow.employee_id,
      corrected_by: employee.id,
      alasan: form.alasan.trim(),
      before_clock_in: editingRow.clock_in,
      before_clock_out: editingRow.clock_out,
      before_status_telat: editingRow.status_telat,
      after_clock_in: newClockIn,
      after_clock_out: newClockOut,
      after_status_telat: form.statusTelat,
    }]);

    if (logError) {
      setSaving(false);
      setSaveError(logError.message || 'Gagal menyimpan log koreksi. Koreksi dibatalkan.');
      return;
    }

    const { data, error } = await supabase
      .from('attendance')
      .update({
        clock_in: newClockIn,
        clock_out: newClockOut,
        status_telat: form.statusTelat,
      })
      .eq('id', editingRow.id)
      .select()
      .single();

    setSaving(false);
    if (error) {
      setSaveError(error.message || 'Gagal menyimpan koreksi, coba lagi.');
      return;
    }

    setAttendance((prev) => prev.map((r) => (r.id === data.id ? data : r)));
    setEditingRow(null);
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
          <ErrorState message={loadError} onRetry={loadData} />
        </div>
      </section>
    );
  }

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const inputClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Koreksi Absensi</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">Koreksi manual clock in/out — misal GPS gagal, HP mati, atau lupa clock out.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
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
        <label className="flex items-center gap-2 text-xs text-[#6B6B6B] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={onlyBermasalah}
            onChange={(e) => setOnlyBermasalah(e.target.checked)}
          />
          Hanya yang bermasalah (belum clock out / foto gagal)
        </label>
      </div>

      <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#6B6B6B] text-xs px-4 py-3 mb-6">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        Setiap koreksi wajib diisi alasan dan tercatat di log — nilai lama tidak akan hilang.
      </div>

      {loading ? (
        <LoadingState label="Memuat data absensi..." />
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Nama</th>
                <th className="px-4 py-3 font-medium">Clock In</th>
                <th className="px-4 py-3 font-medium">Clock Out</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState message="Tidak ada record yang cocok dengan filter ini." />
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-[#E0E0E0] last:border-0">
                    <td className="px-4 py-3 text-black whitespace-nowrap">{formatTanggal(row.tanggal)}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{empById[row.employee_id]?.nama || '—'}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{formatWaktu(row.clock_in)}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">
                      {row.clock_out ? formatWaktu(row.clock_out) : (
                        <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-amber-100 text-amber-800">
                          BELUM CLOCK OUT
                        </span>
                      )}
                    </td>
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
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEdit(row)}
                        className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium"
                      >
                        <Pencil size={12} />
                        Koreksi
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {editingRow && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6">
          <div className="bg-white w-full max-w-[440px] p-6 relative">
            <button
              onClick={closeEdit}
              className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black"
            >
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-1">
              Koreksi — {empById[editingRow.employee_id]?.nama}
            </h2>
            <p className="text-xs text-[#9A9A9A] mb-4">{formatTanggal(editingRow.tanggal)}</p>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Jam Clock In</span>
                <input
                  type="time"
                  value={form.clockIn}
                  onChange={(e) => setForm((f) => ({ ...f, clockIn: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Jam Clock Out</span>
                <input
                  type="time"
                  value={form.clockOut}
                  onChange={(e) => setForm((f) => ({ ...f, clockOut: e.target.value }))}
                  className={inputClass}
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs text-[#6B6B6B] mb-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.statusTelat}
                onChange={(e) => setForm((f) => ({ ...f, statusTelat: e.target.checked }))}
              />
              Tandai sebagai telat
            </label>

            <label className="flex flex-col gap-1 mb-4">
              <span className="text-xs text-[#6B6B6B]">Alasan koreksi (wajib)</span>
              <textarea
                value={form.alasan}
                onChange={(e) => setForm((f) => ({ ...f, alasan: e.target.value }))}
                rows={3}
                placeholder="Contoh: HP karyawan mati saat pulang, dikonfirmasi lewat WA."
                className={`${inputClass} resize-none`}
              />
            </label>

            {saveError && (
              <p className="text-xs text-red-600 mb-4">{saveError}</p>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan Koreksi'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}