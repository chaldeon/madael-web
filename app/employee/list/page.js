'use client';

import { useEffect, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { MODULE_OPTIONS } from '@/lib/employeeModules';
import { useModuleAccess } from '@/lib/useModuleAccess';
import Link from 'next/link';

const emptyForm = {
  nama: '',
  employee_id: '',
  email: '',
  perusahaan: '',
  status: 'Aktif',
  is_superadmin: false,
};

export default function EmployeeListPage() {
  const supabase = createClient();
  const { status } = useModuleAccess('employee_list');

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filterPerusahaan, setFilterPerusahaan] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [createdInfo, setCreatedInfo] = useState(null); // { email, tempPassword }

  const [accessEmployee, setAccessEmployee] = useState(null); // employee row lagi dibuka aksesnya
  const [accessModules, setAccessModules] = useState([]); // array module_name yang dicentang
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessSavingKey, setAccessSavingKey] = useState(null);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('employees')
      .select('id, nama, employee_id, email, perusahaan, status, is_superadmin, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setEmployees(data || []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const perusahaanOptions = Array.from(
    new Set(employees.map((e) => e.perusahaan).filter(Boolean))
  );

  const filtered = employees.filter((e) => {
    const matchPerusahaan = !filterPerusahaan || e.perusahaan === filterPerusahaan;
    const matchStatus = !filterStatus || e.status === filterStatus;
    return matchPerusahaan && matchStatus;
  });

  // ---- Tambah Employee ----

  const openAddModal = () => {
    setForm(emptyForm);
    setFormError(null);
    setCreatedInfo(null);
    setShowAddModal(true);
  };

  const handleFormChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmitAdd = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch('/api/employee/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!res.ok) {
        setFormError(data.error || 'Gagal menambah employee.');
        setSubmitting(false);
        return;
      }

      setCreatedInfo({ email: form.email, tempPassword: data.tempPassword });
      fetchEmployees();
    } catch (err) {
      setFormError('Terjadi kesalahan. Coba lagi.');
    }
    setSubmitting(false);
  };

  // ---- Kelola Akses ----

  const openAccessModal = async (employee) => {
    setAccessEmployee(employee);
    setAccessLoading(true);
    const { data } = await supabase
      .from('employee_modules')
      .select('module_name')
      .eq('employee_id', employee.id);
    setAccessModules((data || []).map((m) => m.module_name));
    setAccessLoading(false);
  };

  const toggleModule = async (moduleKey) => {
    if (!accessEmployee) return;
    setAccessSavingKey(moduleKey);

    const alreadyHas = accessModules.includes(moduleKey);

    if (alreadyHas) {
      const { error } = await supabase
        .from('employee_modules')
        .delete()
        .eq('employee_id', accessEmployee.id)
        .eq('module_name', moduleKey);
      if (!error) {
        setAccessModules((prev) => prev.filter((m) => m !== moduleKey));
      }
    } else {
      const { error } = await supabase
        .from('employee_modules')
        .insert([{ employee_id: accessEmployee.id, module_name: moduleKey }]);
      if (!error) {
        setAccessModules((prev) => [...prev, moduleKey]);
      }
    }
    setAccessSavingKey(null);
  };

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const inputClass =
    'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';

  if (status === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
      </section>
    );
  }

  if (status === 'denied') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Kamu tidak punya akses ke modul Employee List.</p>
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

  return (
    <section className="min-h-screen bg-[#F4F4F4] px-6 py-10">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">
              Employee List
            </h1>
            <p className="text-sm text-[#6B6B6B] mt-1">{employees.length} total employee</p>
          </div>
          <button
            onClick={openAddModal}
            className="bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            + Tambah Employee
          </button>
        </div>

        <div className="flex flex-wrap gap-3 mb-6">
          <select value={filterPerusahaan} onChange={(e) => setFilterPerusahaan(e.target.value)} className={selectClass}>
            <option value="">Semua Perusahaan</option>
            {perusahaanOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={selectClass}>
            <option value="">Semua Status</option>
            <option value="Aktif">Aktif</option>
            <option value="Nonaktif">Nonaktif</option>
          </select>
        </div>

        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          {loading ? (
            <p className="text-sm text-[#6B6B6B] p-6">Memuat data...</p>
          ) : error ? (
            <p className="text-sm text-madael-red p-6">Gagal memuat data: {error}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-[#6B6B6B] p-6">Tidak ada employee yang cocok dengan filter.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B] tracking-[0.04em]">
                  <th className="px-5 py-3 font-medium">Nama</th>
                  <th className="px-5 py-3 font-medium">Employee ID</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Perusahaan</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Superadmin</th>
                  <th className="px-5 py-3 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp) => (
                  <tr key={emp.id} className="border-b border-[#F0F0F0] last:border-0">
                    <td className="px-5 py-3.5 text-black">{emp.nama}</td>
                    <td className="px-5 py-3.5 text-[#6B6B6B]">{emp.employee_id || '—'}</td>
                    <td className="px-5 py-3.5 text-[#6B6B6B]">{emp.email}</td>
                    <td className="px-5 py-3.5 text-[#6B6B6B]">{emp.perusahaan || '—'}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`text-xs font-medium px-2.5 py-1 ${
                          emp.status === 'Aktif' ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#F4F4F4] text-[#6B6B6B]'
                        }`}
                      >
                        {emp.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`text-xs font-medium px-2.5 py-1 ${
                          emp.is_superadmin ? 'bg-madael-red text-white' : 'bg-[#F4F4F4] text-[#6B6B6B]'
                        }`}
                      >
                        {emp.is_superadmin ? 'Ya' : 'Tidak'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <button
                        onClick={() => openAccessModal(emp)}
                        className="text-madael-red hover:text-madael-dark text-xs font-medium"
                      >
                        Kelola Akses
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal Tambah Employee */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] px-6">
          <div className="w-full max-w-[440px] bg-white border-t-4 border-madael-red p-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-serif text-[20px] font-normal text-black">Tambah Employee</h2>
              <button onClick={() => setShowAddModal(false)} className="text-[#6B6B6B] hover:text-black">
                <X size={20} />
              </button>
            </div>

            {createdInfo ? (
              <div>
                <p className="text-sm text-black mb-4">
                  Akun berhasil dibuat untuk <strong>{createdInfo.email}</strong>. Salin password sementara ini dan sampaikan ke employee secara aman:
                </p>
                <div className="bg-[#F4F4F4] border border-[#E0E0E0] px-4 py-3 text-sm font-mono text-black mb-6 select-all">
                  {createdInfo.tempPassword}
                </div>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
                >
                  Selesai
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmitAdd} className="space-y-4">
                <div>
                  <label className={labelClass}>Nama</label>
                  <input
                    required
                    value={form.nama}
                    onChange={(e) => handleFormChange('nama', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Employee ID</label>
                  <input
                    value={form.employee_id}
                    onChange={(e) => handleFormChange('employee_id', e.target.value)}
                    placeholder="MDL002"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Email</label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => handleFormChange('email', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Perusahaan</label>
                  <input
                    value={form.perusahaan}
                    onChange={(e) => handleFormChange('perusahaan', e.target.value)}
                    placeholder="Madael"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => handleFormChange('status', e.target.value)}
                    className={inputClass}
                  >
                    <option value="Aktif">Aktif</option>
                    <option value="Nonaktif">Nonaktif</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-black">
                  <input
                    type="checkbox"
                    checked={form.is_superadmin}
                    onChange={(e) => handleFormChange('is_superadmin', e.target.checked)}
                  />
                  Superadmin
                </label>

                {formError && <p className="text-sm text-madael-red">{formError}</p>}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal Kelola Akses */}
      {accessEmployee && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] px-6">
          <div className="w-full max-w-[420px] bg-white border-t-4 border-madael-red p-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-serif text-[20px] font-normal text-black">Kelola Akses</h2>
              <button onClick={() => setAccessEmployee(null)} className="text-[#6B6B6B] hover:text-black">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-[#6B6B6B] mb-6">{accessEmployee.nama}</p>

            {accessEmployee.is_superadmin ? (
              <p className="text-sm text-black bg-[#F4F4F4] border border-[#E0E0E0] px-4 py-3">
                Employee ini superadmin — otomatis punya akses ke semua modul.
              </p>
            ) : accessLoading ? (
              <p className="text-sm text-[#6B6B6B]">Memuat...</p>
            ) : (
              <div className="space-y-1">
                {MODULE_OPTIONS.map((mod) => {
                  const checked = accessModules.includes(mod.key);
                  const saving = accessSavingKey === mod.key;
                  return (
                    <label
                      key={mod.key}
                      className="flex items-center gap-3 px-1 py-2.5 border-b border-[#F0F0F0] last:border-0 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={saving}
                        onChange={() => toggleModule(mod.key)}
                      />
                      <span className="text-sm text-black">{mod.label}</span>
                      {saving && <span className="text-xs text-[#9A9A9A] ml-auto">menyimpan...</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}