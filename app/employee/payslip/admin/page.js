'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Plus, Eye, Pencil } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

import { useModuleAccess } from '@/lib/useModuleAccess';

import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

import SortableHeader from '@/components/SortableHeader';
import PayslipFormModal from '@/components/payslip-admin/PayslipFormModal';
import { buildPeriodeLabel, previewNomorDokumen, NUMERIC_KEYS, EMPTY_FORM, calcTHP, SORT_COLUMNS } from '@/lib/payslipAdminConfig';
import { formatRupiah } from '@/lib/format';
import { friendlyError } from '@/lib/errorMessage';
import PaginationBar from '@/components/PaginationBar';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { ADMIN_PAGE_SIZE_DEFAULT, totalPagesOf, isRangeNotSatisfiable } from '@/lib/pagination';

export default function PayslipAdminPage() {
  const supabase = createClient();
  const { status } = useModuleAccess('payslip_admin');

  const [payslips, setPayslips] = useState([]);
  const [employees, setEmployees] = useState([]);
  // Paginasi server-side: filter karyawan/periode dan halaman diproses di query.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ADMIN_PAGE_SIZE_DEFAULT);
  const [totalCount, setTotalCount] = useState(0);
  // Daftar karyawan cukup dimuat sekali (tidak ikut berubah saat ganti halaman/filter).
  const employeesLoadedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterPeriode, setFilterPeriode] = useState('');
  const [sortField, setSortField] = useState('periode');
  const [sortDir, setSortDir] = useState('desc');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  // Snapshot data awal form (dipakai buat dirty-check di PayslipFormModal).
  const formBaselineRef = useRef(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Slip dimuat per halaman (range + count) dengan filter di server — dulu seluruh
  // riwayat ditarik sekaligus dan terpotong di batas 1.000 baris. Urutan dari
  // server: periode terbaru dulu; urutan kolom di tabel hanya berlaku pada baris
  // di halaman yang sedang dibuka.
  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let query = supabase
      .from('payslips')
      .select('*, employees ( id, nama )', { count: 'exact' });
    if (filterEmployee) query = query.eq('employee_id', filterEmployee);
    if (filterPeriode) query = query.eq('periode', filterPeriode);
    // `id` sebagai pemutus seri supaya urutan antar halaman deterministik.
    query = query
      .order('periode', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    // Daftar karyawan aktif untuk filter & form — semuanya (bukan per halaman),
    // lewat fetchAllRows supaya tidak terpotong di 1.000 baris.
    const [slipsRes, empsRes] = await Promise.all([
      query,
      employeesLoadedRef.current
        ? Promise.resolve(null)
        : fetchAllRows(() =>
            supabase.from('employees').select('id, nama').eq('status', 'Aktif').order('nama')
          ),
    ]);
    const { data, error, count } = slipsRes;

    // Halaman melewati akhir data: kembali ke halaman 1 — perubahan page
    // memicu muat ulang otomatis.
    if (isRangeNotSatisfiable(error) && page > 1) {
      setPage(1);
      return;
    }
    if (error || empsRes?.error) {
      setLoadError(friendlyError(error || empsRes.error, 'Gagal memuat data slip gaji.'));
      setLoading(false);
      return;
    }

    const total = count || 0;
    if ((data || []).length === 0 && total > 0 && page > 1) {
      setPage(totalPagesOf(total, pageSize));
      return;
    }

    if (empsRes) {
      setEmployees(empsRes.data || []);
      employeesLoadedRef.current = true;
    }
    setPayslips(data || []);
    setTotalCount(total);
    setLoading(false);
  }, [supabase, page, pageSize, filterEmployee, filterPeriode]);

  useEffect(() => {
    if (status === 'allowed') loadData();
  }, [status, loadData]);

  // Filter sudah diterapkan di server; di sini hanya urutan kolom pada halaman aktif.
  const filtered = useMemo(() => {
    const base = payslips;

    const getValue = SORT_COLUMNS[sortField]?.get;
    if (!getValue) return base;

    const sorted = [...base].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [payslips, sortField, sortDir]);

  const handleSort = (colKey) => {
    if (sortField === colKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(colKey);
      setSortDir('asc');
    }
  };

  const openCreate = async () => {
    const tahunSekarang = String(new Date().getFullYear());
    const initial = { ...EMPTY_FORM, periode: `${tahunSekarang}-`, periode_label: '' };
    formBaselineRef.current = initial;
    setForm(initial);
    setEditingId(null);
    setModalOpen(true);
    const { data } = await supabase
      .from('document_counters')
      .select('last_number')
      .eq('kode', 'INV')
      .maybeSingle();
    // nomor_dokumen ini diisi otomatis, bukan diketik user — masukkan juga ke
    // baseline supaya tidak dianggap "perubahan" begitu modal baru dibuka.
    const nomorPreview = previewNomorDokumen(data?.last_number);
    formBaselineRef.current = { ...formBaselineRef.current, nomor_dokumen: nomorPreview };
    setForm((prev) => ({ ...prev, nomor_dokumen: nomorPreview }));
  };

  const openEdit = (p) => {
    const next = { ...EMPTY_FORM };
    Object.keys(next).forEach((key) => {
      if (p[key] !== undefined && p[key] !== null) next[key] = p[key];
    });
    next.employee_id = p.employee_id;
    formBaselineRef.current = next;
    setForm(next);
    setEditingId(p.id);
    setModalOpen(true);
  };

  const handleSubmit = async (bpjsTkPerusahaan) => {
    setSaving(true);
    setSaveError(null);
    const payload = { ...form, bpjs_tk_perusahaan: bpjsTkPerusahaan };
    NUMERIC_KEYS.forEach((k) => { payload[k] = Number(payload[k]) || 0; });
    if (!payload.tanggal_pembayaran) payload.tanggal_pembayaran = null;
    delete payload.employees;

    // Jaga-jaga: selalu turunkan ulang Periode Label dari Periode tepat sebelum
    // disimpan, supaya tidak pernah kosong walau ada celah sinkronisasi di form.
    if (/^\d{4}-\d{2}$/.test(payload.periode || '')) {
      const [tahunFinal, bulanFinal] = payload.periode.split('-');
      payload.periode_label = buildPeriodeLabel(tahunFinal, bulanFinal);
    } else {
      setSaving(false);
      setSaveError('Periode belum lengkap, pilih Tahun dan Bulan terlebih dahulu.');
      return;
    }

    // Nomor dokumen baru hanya digenerate (dan counter INV di-increment) saat membuat slip baru
    if (!editingId) {
      const res = await fetch('/api/documents/generate-number', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kode_jenis: 'INV' }),
      });
      const numberData = await res.json();
      if (!res.ok) {
        setSaving(false);
        setSaveError(numberData.error || 'Gagal generate nomor dokumen.');
        return;
      }
      payload.nomor_dokumen = numberData.nomor_surat;
    }

    // is_published TIDAK ikut disimpan lewat update/insert langsung: terbit/tarik
    // slip hanya lewat /api/payslips/[id]/publish (log + notifikasi server-side;
    // trigger DB menolak perubahan is_published dari browser).
    const wantPublished = !!payload.is_published;
    const wasPublished = !!formBaselineRef.current?.is_published;
    delete payload.is_published;

    let error;
    let savedId = editingId;
    if (editingId) {
      ({ error } = await supabase.from('payslips').update(payload).eq('id', editingId));
    } else {
      let inserted;
      ({ data: inserted, error } = await supabase
        .from('payslips')
        .insert({ ...payload, is_published: false })
        .select('id')
        .single());
      savedId = inserted?.id;
    }

    if (error) {
      setSaving(false);
      setSaveError(friendlyError(error, 'Gagal menyimpan, coba lagi.'));
      return;
    }

    if (savedId && wantPublished !== wasPublished) {
      const publishError = await requestPublish(savedId, wantPublished);
      if (publishError) {
        // Slip sudah tersimpan; hanya status terbitnya yang gagal.
        setSaving(false);
        setModalOpen(false);
        setActionError(`Slip tersimpan, tetapi status publish gagal diubah: ${publishError}`);
        loadData();
        return;
      }
    }

    setSaving(false);
    setModalOpen(false);
    loadData();
  };

  // Terbit/tarik slip lewat server. Return null kalau berhasil, atau pesan error.
  const requestPublish = async (payslipId, publish) => {
    try {
      const res = await fetch(`/api/payslips/${payslipId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return json.error || 'terjadi kesalahan.';
      return null;
    } catch (err) {
      console.error('Publish slip error:', err);
      return 'koneksi bermasalah, coba lagi.';
    }
  };

  const togglePublish = async (p) => {
    setActionError(null);
    const willPublish = !p.is_published;
    const publishError = await requestPublish(p.id, willPublish);
    if (publishError) {
      setActionError(`Gagal update status "${p.employees?.nama || 'slip ini'}": ${publishError}`);
      return;
    }

    setPayslips((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_published: willPublish } : x)));
  };

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  if (status === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat..." />
      </section>
    );
  }

  if (status === 'denied') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Kamu tidak punya akses ke halaman Kelola Slip Gaji.</p>
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

  if (loadError) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px]">
          <ErrorState message={loadError} onRetry={loadData} />
        </div>
      </section>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-10">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Kelola Slip Gaji</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">
            {totalCount} {filterEmployee || filterPeriode ? 'slip gaji sesuai filter' : 'total slip gaji'}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors"
        >
          <Plus size={16} />
          Tambah Slip Gaji
        </button>
      </div>

      {actionError && (
        <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 mb-4">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="shrink-0 hover:text-red-900">✕</button>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={filterEmployee}
          onChange={(e) => { setFilterEmployee(e.target.value); setPage(1); }}
          className={selectClass}
        >
          <option value="">Semua Karyawan</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.nama}</option>
          ))}
        </select>
        <input
          type="month"
          value={filterPeriode}
          onChange={(e) => { setFilterPeriode(e.target.value); setPage(1); }}
          aria-label="Filter periode"
          className={selectClass}
        />
        {filterPeriode && (
          <button
            type="button"
            onClick={() => { setFilterPeriode(''); setPage(1); }}
            className="text-xs text-madael-red hover:text-madael-dark font-medium"
          >
            Semua periode
          </button>
        )}
      </div>

      <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
        {loading ? (
          <LoadingState label="Memuat data slip gaji..." />
        ) : filtered.length === 0 ? (
          <EmptyState
            message={
              filterEmployee || filterPeriode
                ? 'Tidak ada slip gaji yang cocok dengan filter ini.'
                : 'Belum ada slip gaji. Klik "Tambah Slip Gaji" untuk mulai.'
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B] tracking-[0.04em]">
                <SortableHeader colKey="nama" label="Nama Karyawan" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="periode" label="Periode" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="nomor_dokumen" label="Nomor Dokumen" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="thp" label="Take Home Pay" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-[#F0F0F0] last:border-0">
                  <td className="px-5 py-3.5 text-black">{p.employees?.nama || '—'}</td>
                  <td className="px-5 py-3.5 text-[#3D3D3D]">{p.periode_label || p.periode}</td>
                  <td className="px-5 py-3.5 text-[#6B6B6B]">{p.nomor_dokumen || '—'}</td>
                  <td className="px-5 py-3.5 text-black">{formatRupiah(calcTHP(p))}</td>
                  <td className="px-5 py-3.5">
                    <button
                      onClick={() => togglePublish(p)}
                      className={`text-xs font-medium px-2.5 py-1.5 transition-colors ${
                        p.is_published ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#F4F4F4] text-[#6B6B6B]'
                      }`}
                    >
                      {p.is_published ? 'Published' : 'Draft'}
                    </button>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <button onClick={() => openEdit(p)} className="text-[#6B6B6B] hover:text-madael-red" title="Edit">
                        <Pencil size={15} />
                      </button>
                      <Link href={`/employee/payslip/${p.id}`} target="_blank" className="text-[#6B6B6B] hover:text-madael-red" title="Lihat">
                        <Eye size={15} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && (
        <PaginationBar
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          catatanUrutan
          satuan="slip gaji"
        />
      )}

      {modalOpen && (
        <PayslipFormModal
          form={form}
          setForm={setForm}
          employees={employees}
          supabase={supabase}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
          saving={saving}
          isEdit={!!editingId}
          saveError={saveError}
          isDirty={JSON.stringify(form) !== JSON.stringify(formBaselineRef.current)}
        />
      )}
    </div>
  );
}