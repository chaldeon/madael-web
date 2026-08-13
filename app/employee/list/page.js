'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { X, ArrowUp, ArrowDown, ArrowUpDown, Upload, Download, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { MODULE_OPTIONS } from '@/lib/employeeModules';
import { nextEmployeeId } from '@/lib/employeeId';

const emptyForm = {
  nama: '',
  employee_id: '',
  email: '',
  client_id: '',
  status: 'Aktif',
  is_superadmin: false,
};

const TEMPLATE_URL = '/templates/template-bulk-employee.xlsx';

// Kolom yang bisa disortir + cara ambil value-nya dari row employee.
const SORT_COLUMNS = {
  nama: { label: 'Nama', get: (e) => (e.nama || '').toLowerCase() },
  employee_id: { label: 'Employee ID', get: (e) => e.employee_id || '' },
  email: { label: 'Email', get: (e) => (e.email || '').toLowerCase() },
  perusahaan: { label: 'Perusahaan', get: (e) => (e.companies?.nama_perusahaan || '').toLowerCase() },
  status: { label: 'Status', get: (e) => e.status || '' },
  is_superadmin: { label: 'Superadmin', get: (e) => (e.is_superadmin ? 1 : 0) },
};

// Dropdown perusahaan (companies) + opsi tambah baru inline — dipakai di
// form Tambah & Edit Employee. Perusahaan baru langsung tersimpan ke
// `companies`, tabel yang sama dipakai Payroll Manager/CRM/dll.
function CompanySelect({ value, onChange, companies, onAddCompany, inputClass, labelClass }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const id = await onAddCompany(newName);
    setSaving(false);
    if (id) {
      onChange(id);
      setAdding(false);
      setNewName('');
    }
  };

  return (
    <div>
      <label className={labelClass}>Perusahaan</label>
      {!adding ? (
        <div className="flex gap-2">
          <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
            <option value="">— Pilih Perusahaan —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.nama_perusahaan}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="shrink-0 px-3 text-sm text-madael-red hover:text-madael-dark whitespace-nowrap"
          >
            + Baru
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nama perusahaan baru"
            className={inputClass}
          />
          <button
            type="button"
            disabled={saving}
            onClick={handleAdd}
            className="shrink-0 px-3 text-sm bg-madael-red text-white hover:bg-madael-dark disabled:opacity-50"
          >
            {saving ? '...' : 'Simpan'}
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewName(''); }}
            className="shrink-0 px-2 text-sm text-[#6B6B6B] hover:text-black"
          >
            Batal
          </button>
        </div>
      )}
    </div>
  );
}

// Header kolom tabel yang bisa diklik buat sortir.
function SortableHeader({ colKey, label, sortField, sortDir, onSort }) {
  const active = sortField === colKey;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className="px-5 py-3 font-medium">
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

export default function EmployeeListPage() {
  const supabase = createClient();

  const [employees, setEmployees] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filterClientId, setFilterClientId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const [sortField, setSortField] = useState('nama');
  const [sortDir, setSortDir] = useState('asc');

  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [createdInfo, setCreatedInfo] = useState(null); // { email, tempPassword }

  const [accessEmployee, setAccessEmployee] = useState(null); // employee row lagi dibuka aksesnya
  const [accessModules, setAccessModules] = useState([]); // array module_name yang dicentang
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessSavingKey, setAccessSavingKey] = useState(null);

  // ---- Bulk Import ----
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkRows, setBulkRows] = useState([]); // hasil parse, siap dikirim
  const [bulkParseError, setBulkParseError] = useState(null);
  const [bulkParsing, setBulkParsing] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResult, setBulkResult] = useState(null); // { successCount, errorCount, results }

  // Perusahaan tempat karyawan bekerja/ditempatkan (termasuk outsourcing) —
  // narik dari `companies`, satu sumber yang sama dipakai Payroll Manager,
  // CRM, Invoice, dst. Employee List sendiri tetap murni data akun login.
  const fetchCompanies = useCallback(async () => {
    const { data } = await supabase
      .from('companies')
      .select('id, nama_perusahaan')
      .order('nama_perusahaan', { ascending: true });
    setCompanies(data || []);
  }, [supabase]);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('employees')
      .select('id, nama, employee_id, email, client_id, companies:client_id ( id, nama_perusahaan ), status, is_superadmin, created_at')
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
    fetchCompanies();
  }, [fetchEmployees, fetchCompanies]);

  const handleSort = (colKey) => {
    if (sortField === colKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(colKey);
      setSortDir('asc');
    }
  };

  const filtered = useMemo(() => {
    const rows = employees.filter((e) => {
      const matchPerusahaan = !filterClientId || e.client_id === filterClientId;
      const matchStatus = !filterStatus || e.status === filterStatus;
      return matchPerusahaan && matchStatus;
    });

    const getValue = SORT_COLUMNS[sortField]?.get;
    if (!getValue) return rows;

    const sorted = [...rows].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [employees, filterClientId, filterStatus, sortField, sortDir]);

  // Tambah perusahaan baru langsung dari sini — nulis ke tabel `companies`
  // yang sama, jadi otomatis muncul juga di Payroll Manager/CRM/dll.
  const addCompanyInline = async (nama) => {
    const trimmed = nama.trim();
    if (!trimmed) return null;
    const existing = companies.find((c) => c.nama_perusahaan.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;

    const { data, error } = await supabase
      .from('companies')
      .insert([{ nama_perusahaan: trimmed, tipe: ['client'] }])
      .select('id, nama_perusahaan')
      .single();
    if (error) return null;
    setCompanies((prev) => [...prev, data].sort((a, b) => a.nama_perusahaan.localeCompare(b.nama_perusahaan)));
    return data.id;
  };

  // ---- Tambah Employee ----

  const openAddModal = () => {
    // Employee ID disarankan otomatis (format MDL0001, urut, 4 digit) dari ID
    // tertinggi yang sudah ada — superadmin masih bisa timpa manual kalau perlu.
    const suggestedId = nextEmployeeId(employees.map((e) => e.employee_id));
    setForm({ ...emptyForm, employee_id: suggestedId });
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
      } else {
        alert('Gagal menghapus akses modul: ' + error.message);
      }
    } else {
      const { error } = await supabase
        .from('employee_modules')
        .insert([{ employee_id: accessEmployee.id, module_name: moduleKey }]);
      if (!error) {
        setAccessModules((prev) => [...prev, moduleKey]);
      } else {
        alert('Gagal menambah akses modul: ' + error.message);
      }
    }
    setAccessSavingKey(null);
  };

  // ---- Bulk Import ----

  const openBulkModal = () => {
    setBulkFile(null);
    setBulkRows([]);
    setBulkParseError(null);
    setBulkResult(null);
    setShowBulkModal(true);
  };

  // Baca file .xlsx yang dipilih user, mapping ke bentuk row yang dipahami
  // /api/employee/bulk-create. Pakai dynamic import supaya library 'xlsx'
  // tidak membengkakkan bundle awal halaman.
  const handleBulkFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFile(file);
    setBulkParseError(null);
    setBulkResult(null);
    setBulkParsing(true);

    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      const rows = raw
        .map((r) => ({
          nama: String(r['Nama'] ?? '').trim(),
          employee_id: String(r['Employee ID (opsional)'] ?? r['Employee ID'] ?? '').trim(),
          email: String(r['Email'] ?? '').trim(),
          perusahaan: String(r['Perusahaan'] ?? '').trim(),
          status: String(r['Status'] ?? '').trim(),
          superadmin: String(r['Superadmin'] ?? '').trim(),
        }))
        .filter((r) => r.nama || r.email); // buang baris kosong total

      if (rows.length === 0) {
        setBulkParseError('Tidak ada baris data yang terbaca. Pastikan pakai template yang disediakan.');
      } else {
        setBulkRows(rows);
      }
    } catch (err) {
      setBulkParseError('Gagal membaca file. Pastikan formatnya .xlsx sesuai template.');
    }
    setBulkParsing(false);
  };

  const handleBulkSubmit = async () => {
    if (bulkRows.length === 0) return;
    setBulkSubmitting(true);
    setBulkParseError(null);

    try {
      const res = await fetch('/api/employee/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: bulkRows }),
      });
      const data = await res.json();

      if (!res.ok) {
        setBulkParseError(data.error || 'Gagal memproses file.');
        setBulkSubmitting(false);
        return;
      }

      setBulkResult(data);
      fetchEmployees();
    } catch (err) {
      setBulkParseError('Terjadi kesalahan. Coba lagi.');
    }
    setBulkSubmitting(false);
  };

  // Download daftar password sementara hasil bulk import sebagai CSV, biar
  // gampang dibagikan/diarsip — tidak perlu discroll & disalin manual satu-satu.
  const downloadBulkPasswords = () => {
    if (!bulkResult) return;
    const success = bulkResult.results.filter((r) => r.status === 'success');
    const header = 'Nama,Employee ID,Email,Password Sementara\n';
    const body = success
      .map((r) => `"${r.nama}","${r.employee_id}","${r.email}","${r.tempPassword}"`)
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'password-employee-baru.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const inputClass =
    'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-10">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">
            Employee List
          </h1>
          <p className="text-sm text-[#6B6B6B] mt-1">{employees.length} total employee</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={openBulkModal}
            className="flex items-center gap-2 border border-[#E0E0E0] text-black px-5 py-2.5 text-sm font-medium tracking-[0.04em] hover:border-madael-red hover:text-madael-red transition-colors"
          >
            <Upload size={16} />
            Bulk Tambah
          </button>
          <button
            onClick={openAddModal}
            className="bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            + Tambah Employee
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <select value={filterClientId} onChange={(e) => setFilterClientId(e.target.value)} className={selectClass}>
          <option value="">Semua Perusahaan</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.nama_perusahaan}</option>
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
                <SortableHeader colKey="nama" label="Nama" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="employee_id" label="Employee ID" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="email" label="Email" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="perusahaan" label="Perusahaan" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="is_superadmin" label="Superadmin" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-medium text-right">Akses</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((emp) => (
                <tr key={emp.id} className="border-b border-[#F0F0F0] last:border-0">
                  <td className="px-5 py-3.5 text-black">
                    <Link href={`/employee/list/${emp.id}`} className="hover:text-madael-red hover:underline underline-offset-2">
                      {emp.nama}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-[#6B6B6B]">{emp.employee_id || '—'}</td>
                  <td className="px-5 py-3.5 text-[#6B6B6B]">{emp.email}</td>
                  <td className="px-5 py-3.5 text-[#6B6B6B]">{emp.companies?.nama_perusahaan || '—'}</td>
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
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => openAccessModal(emp)}
                      title="Kelola Akses"
                      className="inline-flex text-[#6B6B6B] hover:text-madael-red transition-colors"
                    >
                      <ShieldCheck size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
                    placeholder="MDL0001"
                    className={inputClass}
                  />
                  <p className="text-xs text-[#9A9A9A] mt-1">Sudah disarankan otomatis, boleh diganti manual kalau perlu.</p>
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
                <CompanySelect
                  value={form.client_id}
                  onChange={(id) => handleFormChange('client_id', id)}
                  companies={companies}
                  onAddCompany={addCompanyInline}
                  inputClass={inputClass}
                  labelClass={labelClass}
                />
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

      {/* Modal Bulk Tambah Employee */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] px-6">
          <div className="w-full max-w-[560px] bg-white border-t-4 border-madael-red p-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-serif text-[20px] font-normal text-black">Bulk Tambah Employee</h2>
              <button onClick={() => setShowBulkModal(false)} className="text-[#6B6B6B] hover:text-black">
                <X size={20} />
              </button>
            </div>

            {bulkResult ? (
              <div>
                <p className="text-sm text-black mb-4">
                  Selesai diproses: <strong className="text-[#166534]">{bulkResult.successCount} berhasil</strong>
                  {bulkResult.errorCount > 0 && (
                    <> · <strong className="text-madael-red">{bulkResult.errorCount} gagal</strong></>
                  )}
                </p>

                {bulkResult.successCount > 0 && (
                  <button
                    onClick={downloadBulkPasswords}
                    className="flex items-center gap-2 border border-[#E0E0E0] text-black px-4 py-2.5 text-sm font-medium hover:border-madael-red hover:text-madael-red transition-colors mb-4"
                  >
                    <Download size={16} />
                    Download Password Sementara (CSV)
                  </button>
                )}

                <div className="border border-[#E0E0E0] max-h-[280px] overflow-y-auto mb-6">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[#F4F4F4]">
                      <tr className="text-left text-[#6B6B6B]">
                        <th className="px-3 py-2 font-medium">Baris</th>
                        <th className="px-3 py-2 font-medium">Email</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkResult.results.map((r) => (
                        <tr key={r.row} className="border-t border-[#F0F0F0]">
                          <td className="px-3 py-2 text-[#6B6B6B]">{r.row}</td>
                          <td className="px-3 py-2 text-black">{r.email}</td>
                          <td className="px-3 py-2">
                            <span className={r.status === 'success' ? 'text-[#166534]' : 'text-madael-red'}>
                              {r.status === 'success' ? 'Berhasil' : 'Gagal'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[#6B6B6B]">
                            {r.status === 'success' ? r.employee_id : r.error}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button
                  onClick={() => setShowBulkModal(false)}
                  className="w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
                >
                  Selesai
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="text-sm text-black mb-2">
                    Upload file Excel berisi data employee baru. Setiap baris akan otomatis dibuatkan akun login (email + password sementara).
                  </p>
                  <a
                    href={TEMPLATE_URL}
                    download
                    className="inline-flex items-center gap-2 text-sm text-madael-red hover:text-madael-dark font-medium"
                  >
                    <Download size={15} />
                    Download Template Excel
                  </a>
                </div>

                <div>
                  <label className={labelClass}>File Excel (.xlsx)</label>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleBulkFileChange}
                    className="w-full text-sm text-black file:mr-3 file:px-4 file:py-2 file:border-0 file:bg-madael-red file:text-white file:text-sm file:font-medium hover:file:bg-madael-dark file:cursor-pointer cursor-pointer"
                  />
                </div>

                {bulkParsing && <p className="text-sm text-[#6B6B6B]">Membaca file...</p>}
                {bulkParseError && <p className="text-sm text-madael-red">{bulkParseError}</p>}
                {bulkRows.length > 0 && !bulkParsing && (
                  <p className="text-sm text-black bg-[#F4F4F4] border border-[#E0E0E0] px-4 py-3">
                    {bulkRows.length} baris siap diproses dari <strong>{bulkFile?.name}</strong>.
                  </p>
                )}

                <button
                  type="button"
                  disabled={bulkRows.length === 0 || bulkSubmitting}
                  onClick={handleBulkSubmit}
                  className="w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {bulkSubmitting ? 'Memproses...' : `Proses ${bulkRows.length || ''} Employee`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}