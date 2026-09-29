'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { X, Plus, Pencil, Calculator, Paperclip, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { logActivity } from '@/lib/activityLog';

import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

import SortableHeader from '@/components/SortableHeader';
import EmployeeModal from '@/components/payroll/EmployeeModal';
import SelectField from '@/components/payroll/SelectField';
import HitungModal from '@/components/payroll/HitungModal';
import { currentMonthValue, EMPTY_FORM, totalTunjangan, SORT_COLUMNS, objToPairs, pairsToObj } from '@/lib/payrollConfig';
import { formatRupiah } from '@/lib/format';

export default function PayrollManagerPage() {
  const supabase = createClient();

  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [linkableEmployees, setLinkableEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [filterClient, setFilterClient] = useState('');
  const [periode, setPeriode] = useState(currentMonthValue());
  const [sortField, setSortField] = useState('nama');
  const [sortDir, setSortDir] = useState('asc');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  // Snapshot data awal form (EMPTY_FORM saat tambah, data row saat edit).
  const formBaselineRef = useRef(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [hitungRow, setHitungRow] = useState(null);

  const [attachingId, setAttachingId] = useState(null);
  const [attachError, setAttachError] = useState(null);

  // Id employee (superadmin) yang lagi login — dipakai untuk activity log,
  // bukan untuk gating akses (itu sudah ditangani PayrollLayout).
  const [actingEmployeeId, setActingEmployeeId] = useState(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || ignore) return;
      const { data: emp } = await supabase
        .from('employees')
        .select('id')
        .eq('email', user.email)
        .maybeSingle();
      if (!ignore && emp) setActingEmployeeId(emp.id);
    })();
    return () => { ignore = true; };
  }, [supabase]);

  const [scheduledIds, setScheduledIds] = useState(new Set());

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [clRes, empRes, linkableRes, scheduleRes] = await Promise.all([
      supabase.from('companies').select('id, nama_perusahaan').order('nama_perusahaan', { ascending: true }),
      supabase
        .from('employees_master')
        .select('id, nama, client_id, posisi, status, gaji_pokok, tunjangan, komponen_lain, linked_employee_id, status_ptkp, npwp_status, npwp, jkk_rate, no_bpjs_kesehatan, no_bpjs_ketenagakerjaan, nama_rekening, no_rekening, jatah_cuti_tahunan, cuti_terpakai, cuti_terpakai_tahun, created_at, drive_file_id, drive_file_name, drive_file_link, employees:linked_employee_id ( nama )')
        .order('created_at', { ascending: false }),
      supabase.from('employees').select('id, nama, client_id').eq('status', 'Aktif').order('nama'),
      // Fase 1.5 — dipakai hanya untuk badge "Jadwal belum diisi" di tabel
      // utama; tidak butuh detail jam, cukup tahu employee_id mana saja
      // yang sudah punya baris work_schedule.
      supabase.from('work_schedule').select('employee_id'),
    ]);

    if (clRes.error || empRes.error || linkableRes.error || scheduleRes.error) {
      setLoadError((clRes.error || empRes.error || linkableRes.error || scheduleRes.error).message || 'Gagal memuat data payroll.');
      setLoading(false);
      return;
    }

    setClients(clRes.data || []);
    setEmployees(empRes.data || []);
    setLinkableEmployees(linkableRes.data || []);
    setScheduledIds(new Set((scheduleRes.data || []).map((r) => r.employee_id)));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const clientName = (id) => clients.find((c) => c.id === id)?.nama_perusahaan || '—';

  // Fase 1.1 — exclude akun yang sudah dipakai sebagai linked_employee_id di
  // baris employees_master LAIN dari dropdown Nama, supaya satu akun tidak
  // bisa dobel-link. Baris yang sedang diedit (form.id) dikecualikan dari
  // daftar "sudah dipakai" itu sendiri, supaya akun yang memang sudah dia
  // pakai tetap muncul (dan tetap terpilih) saat form dibuka untuk edit.
  const availableLinkableEmployees = useMemo(() => {
    const usedIds = new Set(
      employees
        .filter((row) => row.linked_employee_id && row.id !== form.id)
        .map((row) => row.linked_employee_id)
    );
    return linkableEmployees.filter((emp) => !usedIds.has(emp.id));
  }, [linkableEmployees, employees, form.id]);

  const filteredEmployees = useMemo(() => {
    const base = filterClient ? employees.filter((e) => e.client_id === filterClient) : employees;

    const ctx = { clientName };
    const getValue = SORT_COLUMNS[sortField]?.get;
    if (!getValue) return base;

    const sorted = [...base].sort((a, b) => {
      const va = getValue(a, ctx);
      const vb = getValue(b, ctx);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [employees, filterClient, sortField, sortDir, clientName]);

  const handleSort = (colKey) => {
    if (sortField === colKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(colKey);
      setSortDir('asc');
    }
  };

  const openAdd = () => {
    formBaselineRef.current = EMPTY_FORM;
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (row) => {
    const initial = {
      id: row.id,
      nama: row.employees?.nama || row.nama,
      client_id: row.client_id || '',
      posisi: row.posisi || '',
      status: row.status || 'PHL',
      gaji_pokok: row.gaji_pokok || 0,
      tunjangan: row.tunjangan || 0,
      komponen_lain: objToPairs(row.komponen_lain),
      linked_employee_id: row.linked_employee_id || '',
      status_ptkp: row.status_ptkp || '',
      npwp_status: row.npwp_status || '',
      npwp: row.npwp || '',
      jkk_rate: row.jkk_rate ?? '',
      no_bpjs_kesehatan: row.no_bpjs_kesehatan || '',
      no_bpjs_ketenagakerjaan: row.no_bpjs_ketenagakerjaan || '',
      nama_rekening: row.nama_rekening || '',
      no_rekening: row.no_rekening || '',
      jatah_cuti_tahunan: row.jatah_cuti_tahunan ?? 12,
    };
    formBaselineRef.current = initial;
    setForm(initial);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.nama.trim()) return;
    setSaving(true);
    setSaveError(null);

    const payload = {
      nama: form.nama.trim(),
      client_id: form.client_id || null,
      posisi: form.posisi.trim(),
      status: form.status,
      gaji_pokok: form.gaji_pokok,
      tunjangan: form.tunjangan,
      komponen_lain: pairsToObj(form.komponen_lain),
      linked_employee_id: form.linked_employee_id || null,
      status_ptkp: form.status_ptkp || null,
      npwp_status: form.npwp_status || null,
      npwp: form.npwp.trim() || null,
      jkk_rate: form.jkk_rate === '' ? null : Number(form.jkk_rate),
      no_bpjs_kesehatan: form.no_bpjs_kesehatan.trim() || null,
      no_bpjs_ketenagakerjaan: form.no_bpjs_ketenagakerjaan.trim() || null,
      nama_rekening: form.nama_rekening.trim() || null,
      no_rekening: form.no_rekening.trim() || null,
      jatah_cuti_tahunan: Number(form.jatah_cuti_tahunan) || 12,
    };

    const isEdit = !!form.id;
    const { error } = isEdit
      ? await supabase.from('employees_master').update(payload).eq('id', form.id)
      : await supabase.from('employees_master').insert(payload);

    setSaving(false);

    if (error) {
      setSaveError(error.message || 'Gagal menyimpan, coba lagi.');
      return;
    }

    logActivity(supabase, {
      userId: actingEmployeeId,
      aksi: isEdit ? 'edit_struktur_gaji' : 'tambah_employee_master',
      targetTable: 'employees_master',
      targetId: form.id || null,
      detail: { nama: payload.nama, gaji_pokok: payload.gaji_pokok, tunjangan: payload.tunjangan },
    });

    setModalOpen(false);
    loadData();
  };

  const handleAttach = async (row, file) => {
    if (!file) return;

    setAttachError(null);
    setAttachingId(row.id);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`/api/payroll/${row.id}/document`, {
        method: 'POST',
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Gagal mengupload dokumen.');
      setEmployees((prev) => prev.map((e) => (e.id === body.employee.id ? { ...e, ...body.employee } : e)));
    } catch (err) {
      setAttachError(err.message || 'Gagal mengupload dokumen.');
    } finally {
      setAttachingId(null);
    }
  };

  const handleRemoveAttach = async (row) => {
    if (!confirm('Hapus dokumen ini? File di Google Drive juga akan dihapus.')) return;

    setAttachError(null);
    setAttachingId(row.id);

    try {
      const res = await fetch(`/api/payroll/${row.id}/document`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Gagal menghapus dokumen.');
      setEmployees((prev) => prev.map((e) => (e.id === body.employee.id ? { ...e, ...body.employee } : e)));
    } catch (err) {
      setAttachError(err.message || 'Gagal menghapus dokumen.');
    } finally {
      setAttachingId(null);
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto px-10 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-black">Payroll Manager</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">
            Employee master data dan struktur gaji seluruh klien yang di-manage Madael.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors"
          >
            <Plus size={16} /> Tambah Employee
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        {attachError && <p className="text-xs text-red-600 w-full">{attachError}</p>}
        <SelectField
          label="Filter Klien"
          value={filterClient}
          onChange={setFilterClient}
          options={[{ value: '', label: 'Semua Klien' }, ...clients.map((c) => ({ value: c.id, label: c.nama_perusahaan }))]}
        />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[#6B6B6B]">Periode (untuk Hitung)</span>
          <input
            type="month"
            value={periode}
            onChange={(e) => setPeriode(e.target.value)}
            className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
          />
        </label>
      </div>

      {loading ? (
        <LoadingState label="Memuat data payroll..." />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={loadData} />
      ) : filteredEmployees.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState
            message={
              filterClient
                ? 'Tidak ada employee untuk klien ini.'
                : 'Belum ada employee. Klik "Tambah Employee" untuk mulai.'
            }
          />
        </div>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <SortableHeader className="px-4 py-3" colKey="nama" label="Nama" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader className="px-4 py-3" colKey="klien" label="Klien" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader className="px-4 py-3" colKey="posisi" label="Posisi" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader className="px-4 py-3" colKey="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader className="px-4 py-3" colKey="akun_absensi" label="Akun Absensi" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader className="px-4 py-3" colKey="gaji_pokok" label="Gaji Pokok" sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right" />
                <SortableHeader className="px-4 py-3" colKey="allowance" label="Allowance" sortField={sortField} sortDir={sortDir} onSort={handleSort} align="right" />
                <th className="px-4 py-3 font-medium">Dokumen</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((row) => (
                <tr key={row.id} className="border-b border-[#F0F0F0] last:border-0">
                  <td className="px-4 py-3 text-black">{row.employees?.nama || row.nama}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{clientName(row.client_id)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{row.posisi || '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2.5 py-1 text-[11px] font-medium rounded ${
                        row.status === 'Tetap' ? 'bg-[#E6F4EA] text-[#1E7A34]' : 'bg-[#F3F4F6] text-[#4B5563]'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {row.linked_employee_id ? (
                      scheduledIds.has(row.linked_employee_id) ? (
                        <span className="inline-block px-2.5 py-1 text-[11px] font-medium rounded bg-[#E6F4EA] text-[#1E7A34]">
                          Terhubung
                        </span>
                      ) : (
                        <span
                          title="Akun sudah terhubung tapi belum ada Jadwal Kerja (jam masuk/pulang) — penalty keterlambatan akan dianggap Rp0 sampai jadwal diisi."
                          className="inline-block px-2.5 py-1 text-[11px] font-medium rounded bg-[#FDE8E8] text-[#B91C1C] cursor-help"
                        >
                          Jadwal belum diisi
                        </span>
                      )
                    ) : (
                      <span
                        title="Sisa kuota cuti & referensi kehadiran tidak akan muncul untuk employee ini sampai di-link ke akun absensi (klik Pencil untuk isi 'Akun Absensi')."
                        className="inline-block px-2.5 py-1 text-[11px] font-medium rounded bg-[#FEF3C7] text-[#92400E] cursor-help"
                      >
                        Belum link akun
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-black">{formatRupiah(row.gaji_pokok)}</td>
                  <td className="px-4 py-3 text-right text-black">{formatRupiah(totalTunjangan(row))}</td>
                  <td className="px-4 py-3">
                    {attachingId === row.id ? (
                      <Loader2 size={14} className="animate-spin text-[#9A9A9A]" />
                    ) : row.drive_file_link ? (
                      <div className="flex items-center gap-2">
                        <a
                          href={row.drive_file_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium"
                        >
                          <Paperclip size={12} /> Lihat
                        </a>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttach(row)}
                          className="text-[#9A9A9A] hover:text-red-600"
                          title="Hapus dokumen"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <label className="inline-flex items-center gap-1 text-xs text-[#6B6B6B] hover:text-black cursor-pointer">
                        <Paperclip size={12} /> Upload
                        <input
                          type="file"
                          accept="application/pdf,image/jpeg,image/png"
                          className="hidden"
                          onChange={(e) => handleAttach(row, e.target.files?.[0])}
                        />
                      </label>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/employee/payroll/${row.id}`}
                        className="text-xs text-[#4B5563] hover:text-madael-red font-medium"
                      >
                        Detail
                      </Link>
                      <button
                        onClick={() => setHitungRow(row)}
                        className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium"
                      >
                        <Calculator size={14} />
                        Hitung
                      </button>
                      <button onClick={() => openEdit(row)} className="text-[#6B6B6B] hover:text-madael-red">
                        <Pencil size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <EmployeeModal
          clients={clients}
          linkableEmployees={availableLinkableEmployees}
          form={form}
          setForm={setForm}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
          saving={saving}
          saveError={saveError}
          isDirty={JSON.stringify(form) !== JSON.stringify(formBaselineRef.current)}
        />
      )}

      {hitungRow && (
        <HitungModal
          row={hitungRow}
          periode={periode}
          onClose={() => setHitungRow(null)}
        />
      )}
    </div>
  );
}