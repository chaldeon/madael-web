'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { LayoutGrid, Table2, Plus, X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

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

const UKURAN_OPTIONS = ['Startup', 'SME', 'Enterprise', 'MNC'];

const emptyForm = {
  nama_perusahaan: '',
  industri: '',
  ukuran: '',
  website: '',
  alamat: '',
  kota: '',
  pic_nama: '',
  pic_jabatan: '',
  pic_email: '',
  pic_telepon: '',
  stage: 'Prospek',
  assigned_to: '',
  catatan: '',
};

function StageBadge({ stage }) {
  return (
    <span className={`inline-block px-2.5 py-1 text-[11px] font-medium rounded ${STAGE_STYLES[stage] || 'bg-[#F3F4F6] text-[#4B5563]'}`}>
      {stage}
    </span>
  );
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CrmClientListPage() {
  const supabase = createClient();

  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [view, setView] = useState('kanban'); // 'kanban' | 'table'

  const [filterStage, setFilterStage] = useState('');
  const [filterAssigned, setFilterAssigned] = useState('');
  const [filterIndustri, setFilterIndustri] = useState('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const [draggedId, setDraggedId] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('clients')
      .select('id, created_at, nama_perusahaan, industri, ukuran, website, alamat, kota, pic_nama, pic_jabatan, pic_email, pic_telepon, stage, assigned_to, catatan, is_active, employees:assigned_to ( id, nama )')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setClients(data || []);
    }
    setLoading(false);
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
    fetchClients();
    fetchEmployees();
  }, [fetchClients, fetchEmployees]);

  const industriOptions = useMemo(
    () => Array.from(new Set(clients.map((c) => c.industri).filter(Boolean))).sort(),
    [clients]
  );

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      const matchStage = !filterStage || c.stage === filterStage;
      const matchAssigned = !filterAssigned || c.assigned_to === filterAssigned;
      const matchIndustri = !filterIndustri || c.industri === filterIndustri;
      return matchStage && matchAssigned && matchIndustri;
    });
  }, [clients, filterStage, filterAssigned, filterIndustri]);

  // ---- Update stage (dipakai drag & drop kanban) ----
  const updateStage = async (clientId, newStage) => {
    const prev = clients;
    setClients((cur) => cur.map((c) => (c.id === clientId ? { ...c, stage: newStage } : c)));

    const { error } = await supabase.from('clients').update({ stage: newStage }).eq('id', clientId);
    if (error) {
      setClients(prev); // rollback kalau gagal
      alert('Gagal update stage: ' + error.message);
    }
  };

  const handleDragStart = (clientId) => (e) => {
    setDraggedId(clientId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', clientId);
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
    const client = clients.find((c) => c.id === id);
    if (client && client.stage !== stage) {
      updateStage(id, stage);
    }
  };

  // ---- Tambah klien ----
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
    if (!form.nama_perusahaan.trim()) {
      setFormError('Nama perusahaan wajib diisi.');
      return;
    }
    setSubmitting(true);
    setFormError(null);

    const payload = {
      nama_perusahaan: form.nama_perusahaan.trim(),
      industri: form.industri || null,
      ukuran: form.ukuran || null,
      website: form.website || null,
      alamat: form.alamat || null,
      kota: form.kota || null,
      pic_nama: form.pic_nama || null,
      pic_jabatan: form.pic_jabatan || null,
      pic_email: form.pic_email || null,
      pic_telepon: form.pic_telepon || null,
      stage: form.stage || 'Prospek',
      assigned_to: form.assigned_to || null,
      catatan: form.catatan || null,
    };

    const { error } = await supabase.from('clients').insert(payload);

    if (error) {
      setFormError(error.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setShowAddModal(false);
    fetchClients();
  };

  const inputClass =
    'w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black focus:outline-none focus:border-madael-red';
  const labelClass = 'block text-xs font-medium text-[#6B6B6B] mb-1';

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">CRM — Client List</h1>
        <button
          onClick={openAddModal}
          className="flex items-center gap-1.5 bg-madael-red text-white px-4 py-2 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors cursor-pointer border-0"
        >
          <Plus size={16} /> Tambah Klien
        </button>
      </div>
      <p className="text-sm text-[#6B6B6B] mb-6">Pipeline BD — prospek sampai closed.</p>

      {/* Toolbar: view toggle + filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex border border-[#E0E0E0] bg-white">
          <button
            onClick={() => setView('kanban')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer border-0 ${
              view === 'kanban' ? 'bg-madael-red text-white' : 'bg-white text-[#6B6B6B] hover:text-black'
            }`}
          >
            <LayoutGrid size={14} /> Kanban
          </button>
          <button
            onClick={() => setView('table')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer border-0 border-l border-[#E0E0E0] ${
              view === 'table' ? 'bg-madael-red text-white' : 'bg-white text-[#6B6B6B] hover:text-black'
            }`}
          >
            <Table2 size={14} /> Table
          </button>
        </div>

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
          value={filterAssigned}
          onChange={(e) => setFilterAssigned(e.target.value)}
          className="border border-[#E0E0E0] bg-white px-3 py-2 text-xs text-black focus:outline-none focus:border-madael-red"
        >
          <option value="">Semua BD</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.nama}</option>
          ))}
        </select>

        <select
          value={filterIndustri}
          onChange={(e) => setFilterIndustri(e.target.value)}
          className="border border-[#E0E0E0] bg-white px-3 py-2 text-xs text-black focus:outline-none focus:border-madael-red"
        >
          <option value="">Semua Industri</option>
          {industriOptions.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>

        <span className="text-xs text-[#6B6B6B] ml-auto">{filtered.length} klien</span>
      </div>

      {loading && <p className="text-sm text-[#6B6B6B]">Memuat data klien...</p>}
      {error && <p className="text-sm text-red-600">Error: {error}</p>}

      {!loading && !error && view === 'kanban' && (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const stageClients = filtered.filter((c) => c.stage === stage);
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
                  <span className="text-[11px] text-[#6B6B6B]">{stageClients.length}</span>
                </div>
                <div className="p-2 flex flex-col gap-2 min-h-[80px]">
                  {stageClients.map((c) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={handleDragStart(c.id)}
                      onDragEnd={handleDragEnd}
                      className={`bg-white border border-[#E0E0E0] p-3 cursor-grab active:cursor-grabbing hover:border-madael-red transition-colors ${
                        draggedId === c.id ? 'opacity-40' : ''
                      }`}
                    >
                      <Link href={`/employee/crm/${c.id}`} className="text-sm font-medium text-black hover:text-madael-red block mb-1">
                        {c.nama_perusahaan}
                      </Link>
                      {c.industri && <p className="text-[11px] text-[#6B6B6B] mb-1">{c.industri}</p>}
                      {c.pic_nama && <p className="text-[11px] text-[#6B6B6B]">PIC: {c.pic_nama}</p>}
                      {c.employees?.nama && (
                        <p className="text-[11px] text-madael-red mt-1.5 font-medium">{c.employees.nama}</p>
                      )}
                    </div>
                  ))}
                  {stageClients.length === 0 && (
                    <p className="text-[11px] text-[#B0B0B0] text-center py-4">Kosong</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && !error && view === 'table' && (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-[11px] text-[#6B6B6B] tracking-[0.04em]">
                <th className="px-4 py-3 font-medium">Perusahaan</th>
                <th className="px-4 py-3 font-medium">Industri</th>
                <th className="px-4 py-3 font-medium">PIC</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium">BD</th>
                <th className="px-4 py-3 font-medium">Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-[#F0F0F0] last:border-0 hover:bg-[#FAFAFA]">
                  <td className="px-4 py-3">
                    <Link href={`/employee/crm/${c.id}`} className="font-medium text-black hover:text-madael-red">
                      {c.nama_perusahaan}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[#4B4B4B]">{c.industri || '-'}</td>
                  <td className="px-4 py-3 text-[#4B4B4B]">{c.pic_nama || '-'}</td>
                  <td className="px-4 py-3"><StageBadge stage={c.stage} /></td>
                  <td className="px-4 py-3 text-[#4B4B4B]">{c.employees?.nama || '-'}</td>
                  <td className="px-4 py-3 text-[#4B4B4B]">{formatDate(c.created_at)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#B0B0B0] text-sm">
                    Belum ada klien yang cocok dengan filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Tambah Klien */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-4">
          <div className="bg-white w-full max-w-[560px] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E0E0E0] sticky top-0 bg-white">
              <h2 className="font-serif text-lg text-black">Tambah Klien</h2>
              <button onClick={() => setShowAddModal(false)} className="text-[#6B6B6B] hover:text-black cursor-pointer border-0 bg-transparent">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 flex flex-col gap-4">
              {formError && <p className="text-sm text-red-600">{formError}</p>}

              <div>
                <label className={labelClass}>Nama Perusahaan *</label>
                <input className={inputClass} value={form.nama_perusahaan} onChange={(e) => handleFormChange('nama_perusahaan', e.target.value)} required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Industri</label>
                  <input className={inputClass} value={form.industri} onChange={(e) => handleFormChange('industri', e.target.value)} placeholder="Mining, Manufacturing, dll." />
                </div>
                <div>
                  <label className={labelClass}>Ukuran</label>
                  <select className={inputClass} value={form.ukuran} onChange={(e) => handleFormChange('ukuran', e.target.value)}>
                    <option value="">-</option>
                    {UKURAN_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass}>Website</label>
                <input className={inputClass} value={form.website} onChange={(e) => handleFormChange('website', e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Alamat</label>
                  <input className={inputClass} value={form.alamat} onChange={(e) => handleFormChange('alamat', e.target.value)} />
                </div>
                <div>
                  <label className={labelClass}>Kota</label>
                  <input className={inputClass} value={form.kota} onChange={(e) => handleFormChange('kota', e.target.value)} />
                </div>
              </div>

              <div className="pt-2 border-t border-[#F0F0F0]">
                <p className="text-xs font-semibold text-black mb-3 tracking-[0.02em]">PIC Klien</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Nama PIC</label>
                    <input className={inputClass} value={form.pic_nama} onChange={(e) => handleFormChange('pic_nama', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass}>Jabatan PIC</label>
                    <input className={inputClass} value={form.pic_jabatan} onChange={(e) => handleFormChange('pic_jabatan', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass}>Email PIC</label>
                    <input type="email" className={inputClass} value={form.pic_email} onChange={(e) => handleFormChange('pic_email', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass}>Telepon PIC</label>
                    <input className={inputClass} value={form.pic_telepon} onChange={(e) => handleFormChange('pic_telepon', e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#F0F0F0]">
                <div>
                  <label className={labelClass}>Stage Awal</label>
                  <select className={inputClass} value={form.stage} onChange={(e) => handleFormChange('stage', e.target.value)}>
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Assigned To (BD)</label>
                  <select className={inputClass} value={form.assigned_to} onChange={(e) => handleFormChange('assigned_to', e.target.value)}>
                    <option value="">-</option>
                    {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.nama}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass}>Catatan</label>
                <textarea className={inputClass} rows={3} value={form.catatan} onChange={(e) => handleFormChange('catatan', e.target.value)} />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm text-[#6B6B6B] hover:text-black cursor-pointer border border-[#E0E0E0] bg-white"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-madael-red hover:bg-madael-dark transition-colors cursor-pointer border-0 disabled:opacity-60"
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Klien'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
