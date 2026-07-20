'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { X, Plus, Eye, Pencil } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

const PENDAPATAN_FIELDS = [
  { key: 'gaji_pokok', label: 'Gaji Pokok' },
  { key: 'lembur', label: 'Lembur' },
  { key: 'tunjangan_transport', label: 'Tunjangan Transport' },
  { key: 'tunjangan_lain', label: 'Tunjangan Lain' },
];

const BPJS_PERUSAHAAN_FIELDS = [
  { key: 'jkk_perusahaan', label: 'JKK Perusahaan' },
  { key: 'jkm_perusahaan', label: 'JKM Perusahaan' },
  { key: 'jht_perusahaan', label: 'JHT Perusahaan' },
  { key: 'jp_perusahaan', label: 'JP Perusahaan' },
];

const POTONGAN_FIELDS = [
  { key: 'jht_karyawan', label: 'JHT Karyawan' },
  { key: 'jp_karyawan', label: 'JP Karyawan' },
  { key: 'bpjs_k_karyawan', label: 'BPJS K Karyawan' },
  { key: 'pph21', label: 'PPh 21' },
];

const NUMERIC_KEYS = [
  ...PENDAPATAN_FIELDS.map((f) => f.key),
  ...BPJS_PERUSAHAAN_FIELDS.map((f) => f.key),
  'bpjs_k_perusahaan',
  ...POTONGAN_FIELDS.map((f) => f.key),
];

const EMPTY_FORM = {
  employee_id: '',
  periode: '',
  periode_label: '',
  nomor_dokumen: '',
  gaji_pokok: 0, lembur: 0, tunjangan_transport: 0, tunjangan_lain: 0,
  bpjs_k_perusahaan: 0,
  jkk_perusahaan: 0, jkm_perusahaan: 0, jht_perusahaan: 0, jp_perusahaan: 0,
  jht_karyawan: 0, jp_karyawan: 0, bpjs_k_karyawan: 0, pph21: 0,
  rekening: '', metode_pembayaran: 'Transfer', tanggal_pembayaran: '',
  npwp: '', ptkp: '', no_bpjs_k: '', no_bpjs_tk: '',
  is_published: false,
};

function formatRupiah(value) {
  return 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
}

function NumberField({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[#6B6B6B]">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
      />
    </label>
  );
}

function TextField({ label, value, onChange, type = 'text' }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[#6B6B6B]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
      />
    </label>
  );
}

function PayslipFormModal({ form, setForm, employees, onClose, onSubmit, saving, isEdit, saveError }) {
  const bpjsTkPerusahaan =
    (form.jkk_perusahaan || 0) + (form.jkm_perusahaan || 0) + (form.jht_perusahaan || 0) + (form.jp_perusahaan || 0);
  const totalPendapatan =
    (form.gaji_pokok || 0) + (form.lembur || 0) + (form.tunjangan_transport || 0) + (form.tunjangan_lain || 0) +
    bpjsTkPerusahaan + (form.bpjs_k_perusahaan || 0);
  const totalPotongan =
    (form.jht_karyawan || 0) + (form.jp_karyawan || 0) + (form.bpjs_k_karyawan || 0) + (form.pph21 || 0);
  const takeHomePay =
    (form.gaji_pokok || 0) + (form.lembur || 0) + (form.tunjangan_transport || 0) + (form.tunjangan_lain || 0) - totalPotongan;

  const set = (key) => (val) => setForm((prev) => ({ ...prev, [key]: val }));

  return (
    <div className="fixed inset-0 bg-black/40 z-[1000] flex items-start justify-center overflow-y-auto py-10 px-4">
      <div className="bg-white w-full max-w-[720px] p-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-xl text-black">{isEdit ? 'Edit Slip Gaji' : 'Tambah Slip Gaji'}</h2>
          <button onClick={onClose} className="text-[#6B6B6B] hover:text-black">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-6 max-h-[70vh] overflow-y-auto pr-1">
          {/* Info dasar */}
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-xs text-[#6B6B6B]">Karyawan</span>
              <select
                value={form.employee_id}
                onChange={(e) => set('employee_id')(e.target.value)}
                disabled={isEdit}
                className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors disabled:bg-[#F4F4F4]"
              >
                <option value="">Pilih karyawan...</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.nama}</option>
                ))}
              </select>
            </label>
            <TextField label="Periode (YYYY-MM)" value={form.periode} onChange={set('periode')} />
            <TextField label="Periode Label (mis. Juli 2026)" value={form.periode_label} onChange={set('periode_label')} />
            <TextField label="Nomor Dokumen" value={form.nomor_dokumen} onChange={set('nomor_dokumen')} />
            <TextField label="Rekening" value={form.rekening} onChange={set('rekening')} />
          </div>

          {/* Pendapatan */}
          <div>
            <p className="text-xs font-medium tracking-[0.04em] text-black border-b border-[#E0E0E0] pb-2 mb-3">
              PENDAPATAN
            </p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {PENDAPATAN_FIELDS.map((f) => (
                <NumberField key={f.key} label={f.label} value={form[f.key]} onChange={set(f.key)} />
              ))}
            </div>
            <p className="text-[11px] text-[#9A9A9A] mb-2">Rincian BPJS TK Perusahaan (auto-total: {formatRupiah(bpjsTkPerusahaan)})</p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              {BPJS_PERUSAHAAN_FIELDS.map((f) => (
                <NumberField key={f.key} label={f.label} value={form[f.key]} onChange={set(f.key)} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <NumberField label="BPJS K Perusahaan" value={form.bpjs_k_perusahaan} onChange={set('bpjs_k_perusahaan')} />
            </div>
          </div>

          {/* Potongan */}
          <div>
            <p className="text-xs font-medium tracking-[0.04em] text-black border-b border-[#E0E0E0] pb-2 mb-3">
              POTONGAN
            </p>
            <div className="grid grid-cols-2 gap-4">
              {POTONGAN_FIELDS.map((f) => (
                <NumberField key={f.key} label={f.label} value={form[f.key]} onChange={set(f.key)} />
              ))}
            </div>
          </div>

          {/* Info pembayaran */}
          <div>
            <p className="text-xs font-medium tracking-[0.04em] text-black border-b border-[#E0E0E0] pb-2 mb-3">
              INFO PEMBAYARAN
            </p>
            <div className="grid grid-cols-2 gap-4">
              <TextField label="Metode Pembayaran" value={form.metode_pembayaran} onChange={set('metode_pembayaran')} />
              <TextField label="Tanggal Pembayaran" type="date" value={form.tanggal_pembayaran} onChange={set('tanggal_pembayaran')} />
            </div>
          </div>

          {/* Data pajak & BPJS */}
          <div>
            <p className="text-xs font-medium tracking-[0.04em] text-black border-b border-[#E0E0E0] pb-2 mb-3">
              DATA PAJAK &amp; BPJS
            </p>
            <div className="grid grid-cols-2 gap-4">
              <TextField label="NPWP" value={form.npwp} onChange={set('npwp')} />
              <TextField label="PTKP (mis. K/0)" value={form.ptkp} onChange={set('ptkp')} />
              <TextField label="Nomor BPJS Kesehatan" value={form.no_bpjs_k} onChange={set('no_bpjs_k')} />
              <TextField label="Nomor BPJS Ketenagakerjaan" value={form.no_bpjs_tk} onChange={set('no_bpjs_tk')} />
            </div>
          </div>

          {/* Ringkasan real-time */}
          <div className="bg-[#F4F4F4] p-4 flex flex-col gap-1 text-sm">
            <div className="flex justify-between"><span className="text-[#6B6B6B]">Total Pendapatan</span><span className="text-black">{formatRupiah(totalPendapatan)}</span></div>
            <div className="flex justify-between"><span className="text-[#6B6B6B]">Total Potongan</span><span className="text-black">{formatRupiah(totalPotongan)}</span></div>
            <div className="flex justify-between font-medium"><span className="text-black">Take Home Pay</span><span className="text-madael-red">{formatRupiah(takeHomePay)}</span></div>
          </div>
        </div>

        {saveError && (
          <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 mt-4">
            <span>{saveError}</span>
          </div>
        )}

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#E0E0E0]">
          <label className="flex items-center gap-2 text-sm text-[#3D3D3D]">
            <input
              type="checkbox"
              checked={form.is_published}
              onChange={(e) => set('is_published')(e.target.checked)}
            />
            Publish (terlihat oleh karyawan)
          </label>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-5 py-2.5 text-sm text-[#6B6B6B] hover:text-black transition-colors">
              Batal
            </button>
            <button
              onClick={() => onSubmit(bpjsTkPerusahaan)}
              disabled={saving || !form.employee_id || !form.periode}
              className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors disabled:opacity-40"
            >
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PayslipAdminPage() {
  const supabase = createClient();
  const { status } = useModuleAccess('payslip_admin');

  const [payslips, setPayslips] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterPeriode, setFilterPeriode] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [slipsRes, empsRes] = await Promise.all([
      supabase
        .from('payslips')
        .select('*, employees ( id, nama )')
        .order('periode', { ascending: false }),
      supabase
        .from('employees')
        .select('id, nama')
        .eq('status', 'Aktif')
        .order('nama'),
    ]);

    if (slipsRes.error || empsRes.error) {
      setLoadError((slipsRes.error || empsRes.error).message || 'Gagal memuat data slip gaji.');
      setLoading(false);
      return;
    }

    setPayslips(slipsRes.data || []);
    setEmployees(empsRes.data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (status === 'allowed') loadData();
  }, [status, loadData]);

  const filtered = useMemo(() => {
    return payslips.filter((p) => {
      const matchEmp = !filterEmployee || p.employee_id === filterEmployee;
      const matchPeriode = !filterPeriode || p.periode === filterPeriode;
      return matchEmp && matchPeriode;
    });
  }, [payslips, filterEmployee, filterPeriode]);

  const periodeOptions = useMemo(() => {
    return Array.from(new Set(payslips.map((p) => p.periode))).sort().reverse();
  }, [payslips]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setModalOpen(true);
  };

  const openEdit = (p) => {
    const next = { ...EMPTY_FORM };
    Object.keys(next).forEach((key) => {
      if (p[key] !== undefined && p[key] !== null) next[key] = p[key];
    });
    next.employee_id = p.employee_id;
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

    let error;
    if (editingId) {
      ({ error } = await supabase.from('payslips').update(payload).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('payslips').insert(payload));
    }

    setSaving(false);
    if (error) {
      setSaveError(error.message || 'Gagal menyimpan, coba lagi.');
      return;
    }
    setModalOpen(false);
    loadData();
  };

  const togglePublish = async (p) => {
    setActionError(null);
    const { error } = await supabase
      .from('payslips')
      .update({ is_published: !p.is_published })
      .eq('id', p.id);
    if (error) {
      setActionError(`Gagal update status "${p.employees?.nama || 'slip ini'}": ${error.message}`);
    } else {
      setPayslips((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_published: !p.is_published } : x)));
    }
  };

  const calcTHP = (p) => {
    const totalPotongan = (p.jht_karyawan || 0) + (p.jp_karyawan || 0) + (p.bpjs_k_karyawan || 0) + (p.pph21 || 0);
    return (p.gaji_pokok || 0) + (p.lembur || 0) + (p.tunjangan_transport || 0) + (p.tunjangan_lain || 0) - totalPotongan;
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
          <p className="text-sm text-[#6B6B6B] mt-1">{payslips.length} total slip gaji</p>
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
        <select value={filterEmployee} onChange={(e) => setFilterEmployee(e.target.value)} className={selectClass}>
          <option value="">Semua Karyawan</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.nama}</option>
          ))}
        </select>
        <select value={filterPeriode} onChange={(e) => setFilterPeriode(e.target.value)} className={selectClass}>
          <option value="">Semua Periode</option>
          {periodeOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
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
                <th className="px-5 py-3 font-medium">Nama Karyawan</th>
                <th className="px-5 py-3 font-medium">Periode</th>
                <th className="px-5 py-3 font-medium">Nomor Dokumen</th>
                <th className="px-5 py-3 font-medium">Take Home Pay</th>
                <th className="px-5 py-3 font-medium">Status</th>
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

      {modalOpen && (
        <PayslipFormModal
          form={form}
          setForm={setForm}
          employees={employees}
          onClose={() => setModalOpen(false)}
          onSubmit={handleSubmit}
          saving={saving}
          isEdit={!!editingId}
          saveError={saveError}
        />
      )}
    </div>
  );
}