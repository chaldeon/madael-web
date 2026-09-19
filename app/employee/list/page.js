'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { X, ArrowUp, ArrowDown, ArrowUpDown, Upload, Download, ShieldCheck, Power, Trash2, Search, MoreVertical, AlertCircle, CheckCircle2, FileText } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { getCompletenessInfo } from '@/lib/dataCompleteness';
import { MODULE_OPTIONS } from '@/lib/employeeModules';
import { nextEmployeeId } from '@/lib/employeeId';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { useModalDismiss } from '@/lib/useModalDismiss';

const emptyForm = {
  nama: '',
  employee_id: '',
  email: '',
  client_id: '',
  status: 'Aktif',
  is_superadmin: false,
};

const TEMPLATE_URL = '/templates/template-bulk-employee.xlsx';

// MODULE_OPTIONS itu list flat, tapi sub-permission-nya ditandai lewat
// prefix teks "— Sub: ..." pada label. Susun ulang jadi grup (modul utama +
// sub-modulnya) di sini, sekali saat load, supaya modal "Kelola Akses" bisa
// menampilkannya terindentasi/dikelompokkan alih-alih list checkbox lurus.
const SUB_PREFIX = '— Sub: ';
const MODULE_GROUPS = MODULE_OPTIONS.reduce((groups, mod) => {
  if (mod.label.startsWith(SUB_PREFIX)) {
    const parent = groups[groups.length - 1];
    const child = { ...mod, label: mod.label.slice(SUB_PREFIX.length) };
    if (parent) parent.children.push(child);
    else groups.push({ ...mod, label: child.label, children: [] }); // fallback kalau tidak ada parent di atasnya
  } else {
    groups.push({ ...mod, children: [] });
  }
  return groups;
}, []);

// Pilihan ukuran halaman untuk pagination tabel Employee List.
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// Banner notifikasi non-blocking — pengganti alert() supaya gayanya konsisten
// sama modal custom lain di halaman ini (bukan dialog browser native).
// Auto-dismiss setelah beberapa detik, tapi tetap bisa ditutup manual.
function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onDismiss, toast.type === 'error' ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;
  const isError = toast.type === 'error';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-5 right-5 z-[1100] max-w-[380px] flex items-start gap-2.5 px-4 py-3.5 shadow-lg border-l-4 bg-white ${
        isError ? 'border-madael-red' : 'border-[#166534]'
      }`}
    >
      {isError ? (
        <AlertCircle size={18} className="text-madael-red shrink-0 mt-0.5" />
      ) : (
        <CheckCircle2 size={18} className="text-[#166534] shrink-0 mt-0.5" />
      )}
      <p className="text-sm text-black flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Tutup notifikasi"
        className="text-[#9A9A9A] hover:text-black shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// Menu aksi per baris ("⋯") — pengganti 3 icon polos yang cuma punya title
// tooltip (tidak kebaca di layar sentuh). Klik di luar / Esc menutup menu.
function RowActionsMenu({ emp, canDelete, onManageAccess, onToggleStatus, onDelete, togglingThis }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const item = (label, Icon, onClick, extraClass = '') => (
    <button
      type="button"
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-[#F4F4F4] transition-colors ${extraClass}`}
    >
      <Icon size={14} />
      {label}
    </button>
  );

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Aksi untuk ${emp.nama}`}
        disabled={togglingThis}
        className="inline-flex p-1.5 text-[#6B6B6B] hover:text-black hover:bg-[#F4F4F4] transition-colors disabled:opacity-40"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-52 bg-white border border-[#E0E0E0] shadow-lg z-20 py-1"
        >
          <Link
            href={`/employee/list/dokumen/${emp.id}`}
            onClick={() => setOpen(false)}
            role="menuitem"
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-[#F4F4F4] transition-colors text-black"
          >
            <FileText size={14} />
            Lihat Dokumen
          </Link>
          {item('Kelola Akses', ShieldCheck, () => onManageAccess(emp), 'text-black')}
          {item(
            emp.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan',
            Power,
            () => onToggleStatus(emp),
            emp.status === 'Aktif' ? 'text-madael-red' : 'text-[#166534]'
          )}
          {canDelete && item('Hapus Permanen', Trash2, () => onDelete(emp), 'text-madael-red')}
        </div>
      )}
    </div>
  );
}

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

// Baris skeleton saat data awal masih dimuat — cuma dipakai untuk initial
// load (lihat `loading`), bukan untuk refresh-in-background setelah aksi
// (toggle status/tambah akses sudah update state lokal langsung, tanpa
// nge-refetch penuh, jadi tabel tidak perlu hilang lagi tiap ada aksi).
function SkeletonRows({ rows = 6 }) {
  return (
    <table className="w-full text-sm" aria-hidden="true">
      <tbody>
        {Array.from({ length: rows }).map((_, i) => (
          <tr key={i} className="border-b border-[#F0F0F0] last:border-0 animate-pulse">
            {Array.from({ length: 8 }).map((__, j) => (
              <td key={j} className="px-5 py-3.5">
                <div className="h-3 bg-[#EFEFEF] rounded-sm" style={{ width: j === 0 ? '70%' : '55%' }} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Header kolom tabel yang bisa diklik buat sortir.
function SortableHeader({ colKey, label, sortField, sortDir, onSort }) {
  const active = sortField === colKey;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th className="px-5 py-3 font-medium" aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSort(colKey)}
        aria-label={`Urutkan berdasarkan ${label}${active ? (sortDir === 'asc' ? ', sedang A-Z' : ', sedang Z-A') : ''}`}
        className={`flex items-center gap-1.5 hover:text-black transition-colors ${active ? 'text-black' : ''}`}
      >
        {label}
        <Icon size={12} className={active ? 'text-madael-red' : 'text-[#B0B0B0]'} aria-hidden="true" />
      </button>
    </th>
  );
}

// Nonaktif tidak dinilai kelengkapannya — kosong di situ tidak relevan
// sampai diaktifkan lagi.
function CompletenessBadge({ emp, master, hasSchedule }) {
  if (emp.status !== 'Aktif') {
    return <span className="text-xs text-[#B0B0B0]">—</span>;
  }
  const info = getCompletenessInfo({ master, hasSchedule });
  const styles = {
    complete: 'bg-[#DCFCE7] text-[#166534]',
    warning: 'bg-amber-100 text-amber-800',
    critical: 'bg-red-100 text-red-700',
  };
  return (
    <span
      title={info.missing.length ? `Kosong: ${info.missing.join(', ')}` : undefined}
      className={`inline-block whitespace-nowrap text-xs font-medium px-2.5 py-1 ${styles[info.level]}`}
    >
      {info.label}
    </span>
  );
}

export default function EmployeeListPage() {
  const supabase = createClient();
  // Cuma dipakai untuk tahu apakah viewer yang sedang login superadmin —
  // menentukan boleh/tidaknya lihat tombol "Hapus Permanen". Backend tetap
  // jadi penjaga utama (DELETE /api/employee/[id] cek superadmin sendiri).
  const { employee: viewer } = useModuleAccess('employee_list');

  const [employees, setEmployees] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [masterByEmployeeId, setMasterByEmployeeId] = useState({}); // employee.id -> employees_master row
  const [scheduledIds, setScheduledIds] = useState(new Set()); // employee.id yang sudah punya work_schedule
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filterClientId, setFilterClientId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [sortField, setSortField] = useState('nama');
  const [sortDir, setSortDir] = useState('asc');

  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  // employee_id disarankan beda tiap kali modal dibuka, jadi baseline-nya
  // tidak bisa pakai konstanta emptyForm statis — perlu snapshot per-buka.
  const formBaselineRef = useRef(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [createdInfo, setCreatedInfo] = useState(null); // { email, tempPassword }

  // Notifikasi non-blocking (pengganti alert()) — { type: 'error'|'success', message }
  const [toast, setToast] = useState(null);

  // ---- Nonaktifkan / Aktifkan (soft delete) ----
  const [togglingId, setTogglingId] = useState(null); // employee.id yang sedang diproses
  const [statusConfirmTarget, setStatusConfirmTarget] = useState(null); // employee row yang mau diubah statusnya
  const closeStatusConfirm = useCallback(() => setStatusConfirmTarget(null), []);

  // ---- Hapus Permanen (hard delete, superadmin only) ----
  const [deleteTarget, setDeleteTarget] = useState(null); // employee row yang mau dihapus
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null); // string | { blockingReasons: string[] }

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

  // Pagination tabel — murni render di client, data tetap di-fetch penuh
  // (aman untuk skala saat ini).
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  const handleAddModalBackdrop = useModalDismiss(
    showAddModal,
    () => setShowAddModal(false),
    undefined,
    JSON.stringify(form) !== JSON.stringify(formBaselineRef.current)
  );
  // Tiap checkbox modul di modal ini langsung tersimpan ke server saat
  // diklik (lihat toggleModule) — tidak ada state draft yang bisa hilang,
  // jadi aman langsung tutup tanpa konfirmasi.
  const handleAccessModalBackdrop = useModalDismiss(!!accessEmployee, () => setAccessEmployee(null), false);
  const handleBulkModalBackdrop = useModalDismiss(
    showBulkModal,
    () => setShowBulkModal(false),
    undefined,
    !!bulkFile && !bulkResult
  );
  const handleDeleteModalBackdrop = useModalDismiss(
    !!deleteTarget,
    () => closeDeleteModal(),
    undefined,
    deleteConfirmText.trim() !== ''
  );
  const handleStatusConfirmBackdrop = useModalDismiss(!!statusConfirmTarget, closeStatusConfirm, false);

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
    const [empRes, masterRes, scheduleRes] = await Promise.all([
      supabase
        .from('employees')
        .select('id, nama, employee_id, email, client_id, companies:client_id ( id, nama_perusahaan ), status, is_superadmin, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('employees_master')
        .select('linked_employee_id, status_ptkp, npwp_status, jkk_rate, nama_rekening, no_rekening, alamat, kontak_darurat_nama, kontak_darurat_telepon')
        .not('linked_employee_id', 'is', null),
      supabase.from('work_schedule').select('employee_id'),
    ]);

    const { data, error } = empRes;
    if (error) {
      setError(error.message);
    } else {
      setEmployees(data || []);
    }
    setMasterByEmployeeId(
      Object.fromEntries((masterRes.data || []).map((m) => [m.linked_employee_id, m]))
    );
    setScheduledIds(new Set((scheduleRes.data || []).map((r) => r.employee_id)));
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
    const q = searchQuery.trim().toLowerCase();
    const rows = employees.filter((e) => {
      const matchPerusahaan = !filterClientId || e.client_id === filterClientId;
      const matchStatus = !filterStatus || e.status === filterStatus;
      const matchSearch =
        !q ||
        (e.nama || '').toLowerCase().includes(q) ||
        (e.employee_id || '').toLowerCase().includes(q) ||
        (e.email || '').toLowerCase().includes(q);
      return matchPerusahaan && matchStatus && matchSearch;
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
  }, [employees, filterClientId, filterStatus, searchQuery, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  // Balikin ke halaman valid kalau halaman aktif jadi kosong — misalnya
  // setelah ganti filter, ganti page size, atau data berkurang (hapus/nonaktif).
  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  // Ganti filter, search, atau page size → balik ke halaman 1 (biar nggak
  // nyangkut di halaman yang tiba-tiba jadi nggak relevan).
  useEffect(() => {
    setCurrentPage(1);
  }, [filterClientId, filterStatus, searchQuery, pageSize]);

  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

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
    const initial = { ...emptyForm, employee_id: suggestedId };
    formBaselineRef.current = initial;
    setForm(initial);
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

  // ---- Nonaktifkan / Aktifkan ----
  // Jalur aman default: pakai status Nonaktif, bukan hapus permanen. Sudah
  // ditegakkan di app/employee/dashboard (blok akses) dan useModuleAccess
  // (blok semua modul) begitu status bukan 'Aktif'.
  // Klik icon/menu "Nonaktifkan"/"Aktifkan" cuma buka modal konfirmasi —
  // request PATCH yang sesungguhnya baru jalan di handleConfirmToggleStatus.
  const openStatusConfirm = (emp) => setStatusConfirmTarget(emp);

  const handleConfirmToggleStatus = async () => {
    const emp = statusConfirmTarget;
    if (!emp) return;
    const nextStatus = emp.status === 'Aktif' ? 'Nonaktif' : 'Aktif';

    setTogglingId(emp.id);
    try {
      const res = await fetch(`/api/employee/${emp.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nama: emp.nama,
          employee_id: emp.employee_id,
          client_id: emp.client_id,
          status: nextStatus,
          is_superadmin: emp.is_superadmin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ type: 'error', message: data.error || 'Gagal mengubah status employee.' });
      } else {
        // Update baris terkait langsung di state lokal — tidak perlu refetch
        // penuh (yang tadinya bikin seluruh tabel sempat blank "Memuat data...").
        setEmployees((prev) => prev.map((e) => (e.id === emp.id ? { ...e, status: nextStatus } : e)));
        setToast({
          type: 'success',
          message: nextStatus === 'Aktif' ? `${emp.nama} diaktifkan kembali.` : `${emp.nama} dinonaktifkan.`,
        });
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Terjadi kesalahan. Coba lagi.' });
    }
    setTogglingId(null);
    closeStatusConfirm();
  };

  // ---- Hapus Permanen ----

  const openDeleteModal = (emp) => {
    setDeleteTarget(emp);
    setDeleteConfirmText('');
    setDeleteError(null);
  };

  const closeDeleteModal = () => {
    setDeleteTarget(null);
    setDeleteConfirmText('');
    setDeleteError(null);
    setDeleting(false);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/employee/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json();

      if (!res.ok) {
        setDeleteError(data.blockingReasons ? data : data.error || 'Gagal menghapus employee.');
        setDeleting(false);
        return;
      }

      closeDeleteModal();
      fetchEmployees();
    } catch (err) {
      setDeleteError('Terjadi kesalahan. Coba lagi.');
      setDeleting(false);
    }
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

    try {
      const res = await fetch(`/api/employee/${accessEmployee.id}/modules`, {
        method: alreadyHas ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module_name: moduleKey }),
      });

      // Server ini selalu balas JSON (lihat try/catch di route.js), tapi kalau
      // request-nya gagal sebelum sampai ke handler (mis. 401/middleware,
      // proxy, atau error 500 di luar try/catch), body-nya bisa jadi bukan
      // JSON — res.json() dulu bisa throw dan ketelan jadi pesan generik.
      // Ditangkap terpisah di sini biar pesan errornya kebaca jelas.
      let data = null;
      try {
        data = await res.json();
      } catch (parseErr) {
        setToast({
          type: 'error',
          message: `Server merespons status ${res.status} (bukan format yang dikenali). Cek koneksi/login lalu coba lagi.`,
        });
        setAccessSavingKey(null);
        return;
      }

      if (!res.ok) {
        setToast({
          type: 'error',
          message: (alreadyHas ? 'Gagal menghapus akses modul: ' : 'Gagal menambah akses modul: ') + (data.error || `status ${res.status}`),
        });
      } else if (alreadyHas) {
        setAccessModules((prev) => prev.filter((m) => m !== moduleKey));
      } else {
        setAccessModules((prev) => [...prev, moduleKey]);
      }
    } catch (err) {
      setToast({ type: 'error', message: 'Terjadi kesalahan: ' + (err?.message || 'tidak diketahui') + '. Coba lagi.' });
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
      <Toast toast={toast} onDismiss={() => setToast(null)} />
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
        <div className="relative flex-1 min-w-[240px] max-w-[360px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9A9A9A] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama, employee ID, atau email..."
            className="w-full border border-[#E0E0E0] pl-8 pr-8 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9A9A9A] hover:text-black"
            >
              <X size={14} />
            </button>
          )}
        </div>

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
          <>
            <span className="sr-only" role="status">Memuat data employee...</span>
            <SkeletonRows />
          </>
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
                <th className="px-5 py-3 font-medium whitespace-nowrap">Kelengkapan Data</th>
                <th className="px-5 py-3 font-medium text-right">Akses</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((emp) => (
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
                  <td className="px-5 py-3.5">
                    <Link href={`/employee/list/${emp.id}`}>
                      <CompletenessBadge
                        emp={emp}
                        master={masterByEmployeeId[emp.id]}
                        hasSchedule={scheduledIds.has(emp.id)}
                      />
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end">
                      {/* Menu "⋯" dengan label teks — dulunya 3 icon polos yang cuma
                          punya title tooltip (tidak kebaca di layar sentuh). Hapus
                          Permanen hanya muncul untuk superadmin & bukan akun sendiri;
                          backend (DELETE /api/employee/[id]) menegakkan ulang kedua
                          aturan ini, jadi sembunyikan opsi di sini murni kerapian UI. */}
                      <RowActionsMenu
                        emp={emp}
                        canDelete={viewer?.is_superadmin && viewer.id !== emp.id}
                        onManageAccess={openAccessModal}
                        onToggleStatus={openStatusConfirm}
                        onDelete={openDeleteModal}
                        togglingThis={togglingId === emp.id}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && !error && filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm text-[#6B6B6B]">
          <div>
            Menampilkan {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} dari {filtered.length} employee
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label htmlFor="pageSize" className="whitespace-nowrap">Per halaman</label>
              <select
                id="pageSize"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="border border-[#E0E0E0] px-2 py-1 text-sm"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 border border-[#E0E0E0] disabled:opacity-40 hover:border-madael-red hover:text-madael-red transition-colors"
              >
                Sebelumnya
              </button>
              <span className="px-1 whitespace-nowrap">Halaman {currentPage} / {totalPages}</span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 border border-[#E0E0E0] disabled:opacity-40 hover:border-madael-red hover:text-madael-red transition-colors"
              >
                Berikutnya
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Tambah Employee */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] px-6" onClick={handleAddModalBackdrop}>
          <div className="w-full max-w-[440px] bg-white border-t-4 border-madael-red p-8 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] px-6" onClick={handleAccessModalBackdrop}>
          <div className="w-full max-w-[420px] bg-white border-t-4 border-madael-red p-8 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
              <div className="space-y-0.5">
                {MODULE_GROUPS.map((mod) => {
                  const checked = accessModules.includes(mod.key);
                  const saving = accessSavingKey === mod.key;
                  return (
                    <div key={mod.key} className="border-b border-[#F0F0F0] last:border-0">
                      <label className="flex items-center gap-3 px-1 py-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={saving}
                          onChange={() => toggleModule(mod.key)}
                        />
                        <span className="text-sm text-black">{mod.label}</span>
                        {saving && <span className="text-xs text-[#9A9A9A] ml-auto">menyimpan...</span>}
                      </label>
                      {mod.children.map((child) => {
                        const childChecked = accessModules.includes(child.key);
                        const childSaving = accessSavingKey === child.key;
                        return (
                          <label
                            key={child.key}
                            className="flex items-center gap-3 pl-8 pr-1 py-2 cursor-pointer"
                          >
                            <span className="w-3 h-px bg-[#D8D8D8] shrink-0" aria-hidden="true" />
                            <input
                              type="checkbox"
                              checked={childChecked}
                              disabled={childSaving}
                              onChange={() => toggleModule(child.key)}
                            />
                            <span className="text-sm text-[#3D3D3D]">{child.label}</span>
                            {childSaving && <span className="text-xs text-[#9A9A9A] ml-auto">menyimpan...</span>}
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Nonaktifkan/Aktifkan — sebelumnya window.confirm()
          browser native, sekarang gayanya disamakan dengan modal lain di
          halaman ini. */}
      {statusConfirmTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] px-6" onClick={handleStatusConfirmBackdrop}>
          <div className="w-full max-w-[420px] bg-white border-t-4 border-madael-red p-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-[20px] font-normal text-black">
                {statusConfirmTarget.status === 'Aktif' ? 'Nonaktifkan Employee' : 'Aktifkan Employee'}
              </h2>
              <button onClick={closeStatusConfirm} className="text-[#6B6B6B] hover:text-black">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-black mb-6">
              {statusConfirmTarget.status === 'Aktif' ? (
                <>
                  Nonaktifkan akun <strong>{statusConfirmTarget.nama}</strong>? Dia tidak akan bisa akses
                  dashboard/modul lagi, tapi data historisnya tetap tersimpan.
                </>
              ) : (
                <>Aktifkan kembali akun <strong>{statusConfirmTarget.nama}</strong>?</>
              )}
            </p>
            <div className="flex gap-3">
              <button
                onClick={closeStatusConfirm}
                className="flex-1 border border-[#E0E0E0] text-black px-6 py-3 text-sm font-medium tracking-[0.04em] hover:border-black transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleConfirmToggleStatus}
                disabled={togglingId === statusConfirmTarget.id}
                className="flex-1 bg-madael-red text-white px-6 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {togglingId === statusConfirmTarget.id
                  ? 'Memproses...'
                  : statusConfirmTarget.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Hapus Permanen — dua langkah: kalau backend nolak karena ada
          data historis, tampilkan alasannya dan sarankan Nonaktifkan.
          Kalau boleh dihapus, minta ketik ulang email employee sebagai
          konfirmasi (aksi ini tidak bisa dibatalkan). */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] px-6" onClick={handleDeleteModalBackdrop}>
          <div className="w-full max-w-[440px] bg-white border-t-4 border-madael-red p-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-[20px] font-normal text-black">Hapus Permanen</h2>
              <button onClick={closeDeleteModal} className="text-[#6B6B6B] hover:text-black">
                <X size={20} />
              </button>
            </div>

            {deleteError?.blockingReasons ? (
              <div>
                <p className="text-sm text-black mb-3">
                  <strong>{deleteTarget.nama}</strong> tidak bisa dihapus permanen karena masih punya:
                </p>
                <ul className="text-sm text-[#6B6B6B] list-disc pl-5 mb-4 space-y-1">
                  {deleteError.blockingReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <p className="text-sm text-black mb-6">
                  Data ini wajib disimpan untuk keperluan payroll/pajak/audit. Gunakan tombol{' '}
                  <span className="inline-flex items-center gap-1 font-medium"><Power size={12} /> Nonaktifkan</span>{' '}
                  di baris employee sebagai gantinya.
                </p>
                <button
                  onClick={closeDeleteModal}
                  className="w-full border border-[#E0E0E0] text-black px-8 py-3 text-sm font-medium tracking-[0.04em] hover:border-madael-red hover:text-madael-red transition-colors"
                >
                  Mengerti
                </button>
              </div>
            ) : (
              <div>
                <p className="text-sm text-black mb-2">
                  Menghapus <strong>{deleteTarget.nama}</strong> ({deleteTarget.email}) secara permanen. Aksi ini{' '}
                  <strong>tidak bisa dibatalkan</strong> — akun login dan seluruh data terkait akan hilang.
                </p>
                <p className="text-sm text-[#6B6B6B] mb-4">
                  Kalau employee ini sudah pernah absen, cuti, atau punya slip gaji, sebaiknya pakai Nonaktifkan saja.
                </p>
                <label className="block text-xs font-medium text-[#3D3D3D] mb-1.5">
                  Ketik email employee (<span className="font-mono">{deleteTarget.email}</span>) untuk konfirmasi
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  className="w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors mb-2"
                  autoFocus
                />
                {deleteError && typeof deleteError === 'string' && (
                  <p className="text-sm text-madael-red mb-2">{deleteError}</p>
                )}
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={closeDeleteModal}
                    className="flex-1 border border-[#E0E0E0] text-black px-6 py-3 text-sm font-medium tracking-[0.04em] hover:border-black transition-colors"
                  >
                    Batal
                  </button>
                  <button
                    onClick={handleConfirmDelete}
                    disabled={deleting || deleteConfirmText.trim().toLowerCase() !== deleteTarget.email.toLowerCase()}
                    className="flex-1 bg-madael-red text-white px-6 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {deleting ? 'Menghapus...' : 'Hapus Permanen'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Bulk Tambah Employee */}
      {showBulkModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] px-6" onClick={handleBulkModalBackdrop}>
          <div className="w-full max-w-[560px] bg-white border-t-4 border-madael-red p-8 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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