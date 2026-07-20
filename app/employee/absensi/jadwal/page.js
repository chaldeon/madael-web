'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { X, Pencil } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

const HARI_OPTIONS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
const DEFAULT_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];

const EMPTY_FORM = { jam_masuk: '08:00', jam_pulang: '17:00', hari_kerja: DEFAULT_HARI };

function formatJam(value) {
  return value ? value.slice(0, 5) : '—';
}

export default function JadwalKerjaPage() {
  const router = useRouter();
  const supabase = createClient();

  const [authorized, setAuthorized] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [employees, setEmployees] = useState([]);
  const [schedules, setSchedules] = useState({}); // employee_id -> schedule row
  const [loading, setLoading] = useState(true);

  const [editingEmp, setEditingEmp] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const checkAccess = useCallback(async () => {
    setAuthLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/employee/login');
      return;
    }
    const { data: emp } = await supabase
      .from('employees')
      .select('is_superadmin, status')
      .eq('email', user.email)
      .maybeSingle();

    if (!emp || !emp.is_superadmin || emp.status !== 'Aktif') {
      setAuthError('Halaman ini khusus untuk superadmin.');
      setAuthLoading(false);
      return;
    }
    setAuthorized(true);
    setAuthLoading(false);
  }, [supabase, router]);

  useEffect(() => { checkAccess(); }, [checkAccess]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: emps }, { data: scheds }] = await Promise.all([
      supabase
        .from('employees')
        .select('id, nama, employee_id, perusahaan, status')
        .eq('status', 'Aktif')
        .order('nama'),
      supabase.from('work_schedule').select('*'),
    ]);
    setEmployees(emps || []);
    const byEmp = {};
    (scheds || []).forEach((s) => { byEmp[s.employee_id] = s; });
    setSchedules(byEmp);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (authorized) loadData();
  }, [authorized, loadData]);

  const openEdit = (emp) => {
    const existing = schedules[emp.id];
    setForm(existing
      ? { jam_masuk: formatJam(existing.jam_masuk), jam_pulang: formatJam(existing.jam_pulang), hari_kerja: existing.hari_kerja || DEFAULT_HARI }
      : EMPTY_FORM);
    setEditingEmp(emp);
  };

  const toggleHari = (hari) => {
    setForm((f) => ({
      ...f,
      hari_kerja: f.hari_kerja.includes(hari)
        ? f.hari_kerja.filter((h) => h !== hari)
        : [...f.hari_kerja, hari],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    const { data, error } = await supabase
      .from('work_schedule')
      .upsert(
        [{
          employee_id: editingEmp.id,
          jam_masuk: form.jam_masuk,
          jam_pulang: form.jam_pulang,
          hari_kerja: form.hari_kerja,
        }],
        { onConflict: 'employee_id' }
      )
      .select()
      .single();

    setSaving(false);
    if (error) {
      alert('Gagal menyimpan jadwal: ' + error.message);
      return;
    }
    setSchedules((s) => ({ ...s, [editingEmp.id]: data }));
    setEditingEmp(null);
  };

  if (authLoading) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
      </section>
    );
  }

  if (authError) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">{authError}</p>
          <Link
            href="/employee/dashboard"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali ke Dashboard
          </Link>
        </div>
      </section>
    );
  }

  const inputClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Jadwal Kerja</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">Atur jam masuk, jam pulang, dan hari kerja tiap employee.</p>
        </div>
        <Link href="/employee/absensi" className="text-sm text-[#6B6B6B] hover:text-madael-red">
          ← Absensi
        </Link>
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
                <th className="px-4 py-3 font-medium">Jam Masuk</th>
                <th className="px-4 py-3 font-medium">Jam Pulang</th>
                <th className="px-4 py-3 font-medium">Hari Kerja</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => {
                const sched = schedules[emp.id];
                return (
                  <tr key={emp.id} className="border-b border-[#E0E0E0] last:border-0">
                    <td className="px-4 py-3 text-black">{emp.nama}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{emp.perusahaan || '—'}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{sched ? formatJam(sched.jam_masuk) : '—'}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{sched ? formatJam(sched.jam_pulang) : '—'}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">
                      {sched?.hari_kerja?.length ? sched.hari_kerja.join(', ') : 'Belum diatur'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEdit(emp)}
                        className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium"
                      >
                        <Pencil size={12} />
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
                  value={form.jam_masuk}
                  onChange={(e) => setForm((f) => ({ ...f, jam_masuk: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Jam Pulang</span>
                <input
                  type="time"
                  value={form.jam_pulang}
                  onChange={(e) => setForm((f) => ({ ...f, jam_pulang: e.target.value }))}
                  className={inputClass}
                />
              </label>
            </div>

            <span className="text-xs text-[#6B6B6B] block mb-2">Hari Kerja</span>
            <div className="flex flex-wrap gap-2 mb-6">
              {HARI_OPTIONS.map((hari) => {
                const active = form.hari_kerja.includes(hari);
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

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan Jadwal'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}