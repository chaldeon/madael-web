'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

// Sengaja pakai vocabulary stage yang sama dengan Kanban Perusahaan yang
// sudah ada (bukan daftar stage baru), biar konsisten buat tim.
const STAGES = [
  'Prospek',
  'Dikontrak',
  'Proposal Terkirim',
  'Negosiasi',
  'Closed Won',
  'Closed Lost',
  'On Hold',
];

const STAGE_STYLES = {
  Prospek: 'bg-[#E8F0FE] text-[#1A56DB]',
  Dikontrak: 'bg-[#FEF3C7] text-[#92700C]',
  'Proposal Terkirim': 'bg-[#EDE9FE] text-[#6D28D9]',
  Negosiasi: 'bg-[#FFEDD5] text-[#C2410C]',
  'Closed Won': 'bg-[#DCFCE7] text-[#166534]',
  'Closed Lost': 'bg-[#FEE2E2] text-[#B91C1C]',
  'On Hold': 'bg-[#F3F4F6] text-[#4B5563]',
};

const emptyForm = {
  company_id: '',
  stage: 'Prospek',
  nilai_potensial: '',
  pic_internal: '',
  catatan: '',
};

function formatRupiah(value) {
  if (!value) return '—';
  return 'Rp ' + Math.round(value).toLocaleString('id-ID');
}

function StageBadge({ stage }) {
  return (
    <span className={`inline-block px-2.5 py-1 text-[11px] font-medium rounded ${STAGE_STYLES[stage] || 'bg-[#F3F4F6] text-[#4B5563]'}`}>
      {stage}
    </span>
  );
}

export default function CrmDealsPage() {
  const supabase = createClient();

  const [deals, setDeals] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filterStage, setFilterStage] = useState('');
  const [filterCompany, setFilterCompany] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const [draggedId, setDraggedId] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('crm_deals')
      .select('id, created_at, stage, nilai_potensial, catatan, company_id, companies ( id, nama_perusahaan, industri ), employees:pic_internal ( id, nama )')
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setDeals(data || []);
    }
    setLoading(false);
  }, [supabase]);

  const fetchCompanies = useCallback(async () => {
    const { data } = await supabase
      .from('companies')
      .select('id, nama_perusahaan')
      .eq('is_active', true)
      .order('nama_perusahaan', { ascending: true });
    setCompanies(data || []);
  }, [supabase]);

  const fetchEmployees = useCallback(async () => {
    const { data } = await supabase
      .from('employees')
      .select('id, nama')
      .eq('status', 'Aktif')
      .order('nama', { ascending: true });
    setEmployees(data || []);
  }, [supabase]);

  useEffect(() => {
    fetchDeals();
    fetchCompanies();
    fetchEmployees();
  }, [fetchDeals, fetchCompanies, fetchEmployees]);

  const filtered = useMemo(() => {
    return deals.filter((d) => {
      const matchStage = !filterStage || d.stage === filterStage;
      const matchCompany = !filterCompany || d.company_id === filterCompany;
      return matchStage && matchCompany;
    });
  }, [deals, filterStage, filterCompany]);

  // ---- Update stage (drag & drop) ----
  const updateStage = async (dealId, newStage) => {
    const prev = deals;
    setDeals((cur) => cur.map((d) => (d.id === dealId ? { ...d, stage: newStage } : d)));

    const { error } = await supabase.from('crm_deals').update({ stage: newStage, updated_at: new Date().toISOString() }).eq('id', dealId);
    if (error) {
      setDeals(prev);
      alert('Gagal update stage: ' + error.message);
    }
  };

  const handleDragStart = (dealId) => (e) => {
    setDraggedId(dealId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dealId);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverStage(null);
  };

  const handleColumnDragOver = (stage) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStage(stage);
  };

  const handleColumnDrop = (stage) => (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || draggedId;
    setDragOverStage(null);
    setDraggedId(null);
    if (!id) return;
    const deal = deals.find((d) => d.id === id);
    if (deal && deal.stage !== stage) {
      updateStage(id, stage);
    }
  };

  // ---- Tambah deal ----
  const openAddModal = () => {
    setForm(emptyForm);
    setFormError(null);
    setShowAddModal(true);
  };

  const handleFormChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.company_id) {
      setFormError('Perusahaan wajib dipilih.');
      return;
    }
    setSubmitting(true);
    setFormError(null);

    const payload = {
      company_id: form.company_id,
      stage: form.stage || 'Prospek',
      nilai_potensial: form.nilai_potensial ? Number(form.nilai_potensial) : null,
      pic_internal: form.pic_internal || null,
      catatan: form.catatan.trim() || null,
    };

    const { error } = await supabase.from('crm_deals').insert(payload);
    setSubmitting(false);

    if (error) {
      setFormError(error.message);
      return;
    }
    setShowAddModal(false);
    fetchDeals();
  };

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-black">Pipeline Deal</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">
            Satu perusahaan bisa punya lebih dari satu deal berjalan sekaligus — beda dari stage tunggal di halaman Perusahaan.
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors"
        >
          + Tambah Deal
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <select
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value)}
          className="border border-[#E0E0E0] bg-white px-3 py-2 text-xs text-black focus:outline-none focus:border-madael-red"
        >
          <option value="">Semua Stage</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          value={filterCompany}
          onChange={(e) => setFilterCompany(e.target.value)}
          className="border border-[#E0E0E0] bg-white px-3 py-2 text-xs text-black focus:outline-none focus:border-madael-red"
        >
          <option value="">Semua Perusahaan</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.nama_perusahaan}</option>
          ))}
        </select>

        <span className="text-xs text-[#6B6B6B] ml-auto">{filtered.length} deal</span>
      </div>

      {loading && <p className="text-sm text-[#6B6B6B]">Memuat data deal...</p>}
      {error && <p className="text-sm text-red-600">Error: {error}</p>}

      {!loading && !error && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const stageDeals = filtered.filter((d) => d.stage === stage);
            return (
              <div
                key={stage}
                onDragOver={handleColumnDragOver(stage)}
                onDrop={handleColumnDrop(stage)}
                className={`flex-shrink-0 w-[260px] bg-[#EFEFEF] border ${
                  dragOverStage === stage ? 'border-madael-red' : 'border-[#E0E0E0]'
                } transition-colors`}
              >
                <div className="px-3 py-2.5 border-b border-[#E0E0E0] flex items-center justify-between">
                  <span className="text-xs font-semibold text-black tracking-[0.02em]">{stage}</span>
                  <span className="text-[11px] text-[#6B6B6B]">{stageDeals.length}</span>
                </div>
                <div className="p-2 flex flex-col gap-2 min-h-[80px]">
                  {stageDeals.map((d) => (
                    <div
                      key={d.id}
                      draggable
                      onDragStart={handleDragStart(d.id)}
                      onDragEnd={handleDragEnd}
                      className={`bg-white border border-[#E0E0E0] p-3 cursor-grab active:cursor-grabbing hover:border-madael-red transition-colors ${
                        draggedId === d.id ? 'opacity-40' : ''
                      }`}
                    >
                      <Link href={`/employee/crm/${d.company_id}`} className="text-sm font-medium text-black hover:text-madael-red block mb-1">
                        {d.companies?.nama_perusahaan || '—'}
                      </Link>
                      {d.companies?.industri && <p className="text-[11px] text-[#6B6B6B] mb-1">{d.companies.industri}</p>}
                      {d.nilai_potensial != null && (
                        <p className="text-[11px] text-black font-medium">{formatRupiah(d.nilai_potensial)}</p>
                      )}
                      {d.employees?.nama && (
                        <p className="text-[11px] text-madael-red mt-1.5 font-medium">{d.employees.nama}</p>
                      )}
                      {d.catatan && <p className="text-[11px] text-[#9A9A9A] mt-1 line-clamp-2">{d.catatan}</p>}
                    </div>
                  ))}
                  {stageDeals.length === 0 && (
                    <p className="text-[11px] text-[#B0B0B0] text-center py-4">Kosong</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <form onSubmit={handleSubmit} className="bg-white w-full max-w-[480px] p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-black">Tambah Deal</h2>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-[#6B6B6B] hover:text-black">
                <X size={20} />
              </button>
            </div>

            {formError && <p className="text-sm text-red-600 mb-4">{formError}</p>}

            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Perusahaan</span>
                <select
                  value={form.company_id}
                  onChange={(e) => handleFormChange('company_id', e.target.value)}
                  className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red"
                >
                  <option value="">— Pilih Perusahaan —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.nama_perusahaan}</option>
                  ))}
                </select>
                <span className="text-[11px] text-[#9A9A9A]">
                  Perusahaan belum ada di daftar? Tambahkan dulu di halaman{' '}
                  <Link href="/employee/crm" className="text-madael-red hover:underline">Perusahaan</Link>.
                </span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Stage</span>
                <select
                  value={form.stage}
                  onChange={(e) => handleFormChange('stage', e.target.value)}
                  className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red"
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Nilai Potensial (opsional)</span>
                <input
                  type="number"
                  value={form.nilai_potensial}
                  onChange={(e) => handleFormChange('nilai_potensial', e.target.value)}
                  className="border border-[#E0E0E0] px-3 py-2 text-sm text-black focus:outline-none focus:border-madael-red"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">PIC Internal</span>
                <select
                  value={form.pic_internal}
                  onChange={(e) => handleFormChange('pic_internal', e.target.value)}
                  className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red"
                >
                  <option value="">— Belum ditentukan —</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.nama}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Catatan</span>
                <textarea
                  rows={3}
                  value={form.catatan}
                  onChange={(e) => handleFormChange('catatan', e.target.value)}
                  className="border border-[#E0E0E0] px-3 py-2 text-sm text-black focus:outline-none focus:border-madael-red"
                />
              </label>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setShowAddModal(false)} className="px-5 py-2.5 text-sm text-[#6B6B6B] hover:text-black transition-colors">
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors disabled:opacity-50"
              >
                {submitting ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}