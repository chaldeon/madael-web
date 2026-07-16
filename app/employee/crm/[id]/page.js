'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, X, Pencil } from 'lucide-react';
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

const ACTIVITY_TYPES = ['Email', 'Telepon', 'Meeting', 'Proposal', 'Follow-up', 'Lainnya'];
const PROJECT_STATUS = ['Aktif', 'Selesai', 'On Hold', 'Batal'];
const JENIS_LAYANAN_OPTIONS = ['Outsourcing', 'Rekrutmen', 'EOR', 'Payroll', 'HR Consulting', 'Lainnya'];
const UKURAN_OPTIONS = ['Startup', 'SME', 'Enterprise', 'MNC'];

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

function formatRupiah(value) {
  if (value === null || value === undefined || value === '') return '-';
  return 'Rp ' + Math.round(value).toLocaleString('id-ID');
}

const inputClass =
  'w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black focus:outline-none focus:border-madael-red';
const labelClass = 'block text-xs font-medium text-[#6B6B6B] mb-1';

export default function ClientDetailPage() {
  const params = useParams();
  const supabase = createClient();
  const clientId = params.id;

  const [client, setClient] = useState(null);
  const [activities, setActivities] = useState([]);
  const [projects, setProjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [showStageModal, setShowStageModal] = useState(false);
  const [stageDraft, setStageDraft] = useState('');
  const [savingStage, setSavingStage] = useState(false);

  const [showActivityModal, setShowActivityModal] = useState(false);
  const [activityForm, setActivityForm] = useState(null);
  const [savingActivity, setSavingActivity] = useState(false);

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [projectForm, setProjectForm] = useState(null);
  const [savingProject, setSavingProject] = useState(false);

  const emptyActivity = { tipe: 'Email', judul: '', deskripsi: '', tanggal: new Date().toISOString().slice(0, 10), follow_up_date: '' };
  const emptyProject = { nama_project: '', jenis_layanan: '', status: 'Aktif', nilai_kontrak: '', tanggal_mulai: '', tanggal_selesai: '', pic_madael: '', catatan: '' };

  const loadData = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);

    const [{ data: clientData, error: clientError }, { data: activityData }, { data: projectData }, { data: empData }] = await Promise.all([
      supabase.from('clients').select('*, employees:assigned_to ( id, nama )').eq('id', clientId).maybeSingle(),
      supabase.from('client_activities').select('*, employees:employee_id ( id, nama )').eq('client_id', clientId).order('tanggal', { ascending: false }),
      supabase.from('client_projects').select('*, employees:pic_madael ( id, nama )').eq('client_id', clientId).order('created_at', { ascending: false }),
      supabase.from('employees').select('id, nama').eq('status', 'Aktif').order('nama', { ascending: true }),
    ]);

    if (clientError || !clientData) {
      setError(clientError?.message || 'Klien tidak ditemukan.');
      setLoading(false);
      return;
    }

    setClient(clientData);
    setActivities(activityData || []);
    setProjects(projectData || []);
    setEmployees(empData || []);
    setLoading(false);
  }, [supabase, clientId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ---- Edit info klien ----
  const openEditModal = () => {
    setEditForm({
      nama_perusahaan: client.nama_perusahaan || '',
      industri: client.industri || '',
      ukuran: client.ukuran || '',
      website: client.website || '',
      alamat: client.alamat || '',
      kota: client.kota || '',
      pic_nama: client.pic_nama || '',
      pic_jabatan: client.pic_jabatan || '',
      pic_email: client.pic_email || '',
      pic_telepon: client.pic_telepon || '',
      assigned_to: client.assigned_to || '',
      catatan: client.catatan || '',
    });
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setSavingEdit(true);
    const payload = {
      ...editForm,
      industri: editForm.industri || null,
      ukuran: editForm.ukuran || null,
      website: editForm.website || null,
      alamat: editForm.alamat || null,
      kota: editForm.kota || null,
      pic_nama: editForm.pic_nama || null,
      pic_jabatan: editForm.pic_jabatan || null,
      pic_email: editForm.pic_email || null,
      pic_telepon: editForm.pic_telepon || null,
      assigned_to: editForm.assigned_to || null,
      catatan: editForm.catatan || null,
    };
    const { error } = await supabase.from('clients').update(payload).eq('id', clientId);
    setSavingEdit(false);
    if (error) {
      alert('Gagal menyimpan: ' + error.message);
      return;
    }
    setShowEditModal(false);
    loadData();
  };

  // ---- Ganti stage ----
  const openStageModal = () => {
    setStageDraft(client.stage);
    setShowStageModal(true);
  };

  const handleStageSubmit = async (e) => {
    e.preventDefault();
    setSavingStage(true);
    const { error } = await supabase.from('clients').update({ stage: stageDraft }).eq('id', clientId);
    setSavingStage(false);
    if (error) {
      alert('Gagal ganti stage: ' + error.message);
      return;
    }
    setShowStageModal(false);
    loadData();
  };

  // ---- Tambah aktivitas ----
  const openActivityModal = () => {
    setActivityForm(emptyActivity);
    setShowActivityModal(true);
  };

  const handleActivitySubmit = async (e) => {
    e.preventDefault();
    setSavingActivity(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: currentEmp } = await supabase.from('employees').select('id').eq('email', user?.email).maybeSingle();

    const payload = {
      client_id: clientId,
      employee_id: currentEmp?.id || null,
      tipe: activityForm.tipe,
      judul: activityForm.judul || null,
      deskripsi: activityForm.deskripsi || null,
      tanggal: activityForm.tanggal,
      follow_up_date: activityForm.follow_up_date || null,
    };

    const { error } = await supabase.from('client_activities').insert(payload);
    setSavingActivity(false);
    if (error) {
      alert('Gagal menyimpan aktivitas: ' + error.message);
      return;
    }
    setShowActivityModal(false);
    loadData();
  };

  // ---- Tambah project ----
  const openProjectModal = () => {
    setProjectForm(emptyProject);
    setShowProjectModal(true);
  };

  const handleProjectSubmit = async (e) => {
    e.preventDefault();
    if (!projectForm.nama_project.trim()) return;
    setSavingProject(true);

    const payload = {
      client_id: clientId,
      nama_project: projectForm.nama_project.trim(),
      jenis_layanan: projectForm.jenis_layanan || null,
      status: projectForm.status || 'Aktif',
      nilai_kontrak: projectForm.nilai_kontrak ? Number(projectForm.nilai_kontrak) : null,
      tanggal_mulai: projectForm.tanggal_mulai || null,
      tanggal_selesai: projectForm.tanggal_selesai || null,
      pic_madael: projectForm.pic_madael || null,
      catatan: projectForm.catatan || null,
    };

    const { error } = await supabase.from('client_projects').insert(payload);
    setSavingProject(false);
    if (error) {
      alert('Gagal menyimpan project: ' + error.message);
      return;
    }
    setShowProjectModal(false);
    loadData();
  };

  if (loading) {
    return <div className="max-w-[1200px] mx-auto px-6 py-10"><p className="text-sm text-[#6B6B6B]">Memuat data klien...</p></div>;
  }

  if (error) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-10">
        <p className="text-sm text-red-600 mb-4">{error}</p>
        <Link href="/employee/crm" className="text-sm text-madael-red hover:text-madael-dark">← Kembali ke CRM</Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-10">
      <Link href="/employee/crm" className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-black mb-6">
        <ArrowLeft size={14} /> Kembali ke CRM
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">{client.nama_perusahaan}</h1>
            <StageBadge stage={client.stage} />
          </div>
          <p className="text-sm text-[#6B6B6B]">
            {client.industri || '-'} {client.kota ? `· ${client.kota}` : ''} {client.employees?.nama ? `· BD: ${client.employees.nama}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={openStageModal} className="px-4 py-2 text-sm font-medium text-black border border-[#E0E0E0] bg-white hover:border-madael-red transition-colors cursor-pointer">
            Ganti Stage
          </button>
          <button onClick={openEditModal} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-madael-red hover:bg-madael-dark transition-colors cursor-pointer border-0">
            <Pencil size={14} /> Edit Info
          </button>
        </div>
      </div>

      {/* Dua kolom: info + timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 mb-10">
        {/* Kiri: info perusahaan */}
        <div className="bg-white border border-[#E0E0E0] p-5 h-fit">
          <p className="text-xs font-semibold text-black tracking-[0.02em] mb-4">Info Perusahaan</p>
          <div className="flex flex-col gap-3 text-sm">
            <div><span className="text-[#6B6B6B] text-xs block">Ukuran</span>{client.ukuran || '-'}</div>
            <div><span className="text-[#6B6B6B] text-xs block">Website</span>{client.website || '-'}</div>
            <div><span className="text-[#6B6B6B] text-xs block">Alamat</span>{client.alamat || '-'}</div>
            <div><span className="text-[#6B6B6B] text-xs block">Kota / Negara</span>{[client.kota, client.negara].filter(Boolean).join(', ') || '-'}</div>
          </div>

          <p className="text-xs font-semibold text-black tracking-[0.02em] mt-6 mb-4">PIC Klien</p>
          <div className="flex flex-col gap-3 text-sm">
            <div><span className="text-[#6B6B6B] text-xs block">Nama</span>{client.pic_nama || '-'}</div>
            <div><span className="text-[#6B6B6B] text-xs block">Jabatan</span>{client.pic_jabatan || '-'}</div>
            <div><span className="text-[#6B6B6B] text-xs block">Email</span>{client.pic_email || '-'}</div>
            <div><span className="text-[#6B6B6B] text-xs block">Telepon</span>{client.pic_telepon || '-'}</div>
          </div>

          <p className="text-xs font-semibold text-black tracking-[0.02em] mt-6 mb-2">Catatan</p>
          <p className="text-sm text-[#4B4B4B] whitespace-pre-wrap">{client.catatan || '-'}</p>
        </div>

        {/* Kanan: timeline aktivitas */}
        <div className="bg-white border border-[#E0E0E0] p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-black tracking-[0.02em]">Timeline Aktivitas</p>
            <button onClick={openActivityModal} className="flex items-center gap-1 text-xs font-medium text-madael-red hover:text-madael-dark cursor-pointer border-0 bg-transparent">
              <Plus size={14} /> Tambah Aktivitas
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {activities.map((a) => (
              <div key={a.id} className="border-l-2 border-madael-red pl-3 py-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-medium text-white bg-madael-red px-2 py-0.5 rounded">{a.tipe}</span>
                  <span className="text-xs text-[#6B6B6B]">{formatDate(a.tanggal)}</span>
                  {a.employees?.nama && <span className="text-xs text-[#6B6B6B]">· {a.employees.nama}</span>}
                  {a.follow_up_date && <span className="text-xs text-[#C2410C]">· Follow-up: {formatDate(a.follow_up_date)}</span>}
                </div>
                {a.judul && <p className="text-sm font-medium text-black mt-1">{a.judul}</p>}
                {a.deskripsi && <p className="text-sm text-[#4B4B4B] mt-0.5 whitespace-pre-wrap">{a.deskripsi}</p>}
              </div>
            ))}
            {activities.length === 0 && <p className="text-sm text-[#B0B0B0] py-4 text-center">Belum ada aktivitas tercatat.</p>}
          </div>
        </div>
      </div>

      {/* Section Projects */}
      <div className="bg-white border border-[#E0E0E0] p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold text-black tracking-[0.02em]">Projects / Engagements</p>
          <button onClick={openProjectModal} className="flex items-center gap-1 text-xs font-medium text-madael-red hover:text-madael-dark cursor-pointer border-0 bg-transparent">
            <Plus size={14} /> Tambah Project
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-[11px] text-[#6B6B6B] tracking-[0.04em]">
                <th className="px-3 py-2 font-medium">Nama Project</th>
                <th className="px-3 py-2 font-medium">Jenis Layanan</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Nilai Kontrak</th>
                <th className="px-3 py-2 font-medium">PIC Madael</th>
                <th className="px-3 py-2 font-medium">Mulai - Selesai</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-[#F0F0F0] last:border-0">
                  <td className="px-3 py-2.5 font-medium text-black">{p.nama_project}</td>
                  <td className="px-3 py-2.5 text-[#4B4B4B]">{p.jenis_layanan || '-'}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-block px-2 py-0.5 text-[11px] font-medium rounded bg-[#F3F4F6] text-[#4B5563]">{p.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[#4B4B4B]">{formatRupiah(p.nilai_kontrak)}</td>
                  <td className="px-3 py-2.5 text-[#4B4B4B]">{p.employees?.nama || '-'}</td>
                  <td className="px-3 py-2.5 text-[#4B4B4B]">{formatDate(p.tanggal_mulai)} - {formatDate(p.tanggal_selesai)}</td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-[#B0B0B0]">Belum ada project untuk klien ini.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Edit Info */}
      {showEditModal && editForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-4">
          <div className="bg-white w-full max-w-[560px] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E0E0E0] sticky top-0 bg-white">
              <h2 className="font-serif text-lg text-black">Edit Info Klien</h2>
              <button onClick={() => setShowEditModal(false)} className="text-[#6B6B6B] hover:text-black cursor-pointer border-0 bg-transparent"><X size={18} /></button>
            </div>
            <form onSubmit={handleEditSubmit} className="px-6 py-5 flex flex-col gap-4">
              <div>
                <label className={labelClass}>Nama Perusahaan *</label>
                <input className={inputClass} value={editForm.nama_perusahaan} onChange={(e) => setEditForm((f) => ({ ...f, nama_perusahaan: e.target.value }))} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Industri</label>
                  <input className={inputClass} value={editForm.industri} onChange={(e) => setEditForm((f) => ({ ...f, industri: e.target.value }))} />
                </div>
                <div>
                  <label className={labelClass}>Ukuran</label>
                  <select className={inputClass} value={editForm.ukuran} onChange={(e) => setEditForm((f) => ({ ...f, ukuran: e.target.value }))}>
                    <option value="">-</option>
                    {UKURAN_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>Website</label>
                <input className={inputClass} value={editForm.website} onChange={(e) => setEditForm((f) => ({ ...f, website: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Alamat</label>
                  <input className={inputClass} value={editForm.alamat} onChange={(e) => setEditForm((f) => ({ ...f, alamat: e.target.value }))} />
                </div>
                <div>
                  <label className={labelClass}>Kota</label>
                  <input className={inputClass} value={editForm.kota} onChange={(e) => setEditForm((f) => ({ ...f, kota: e.target.value }))} />
                </div>
              </div>
              <div className="pt-2 border-t border-[#F0F0F0]">
                <p className="text-xs font-semibold text-black mb-3 tracking-[0.02em]">PIC Klien</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Nama PIC</label>
                    <input className={inputClass} value={editForm.pic_nama} onChange={(e) => setEditForm((f) => ({ ...f, pic_nama: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Jabatan PIC</label>
                    <input className={inputClass} value={editForm.pic_jabatan} onChange={(e) => setEditForm((f) => ({ ...f, pic_jabatan: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Email PIC</label>
                    <input type="email" className={inputClass} value={editForm.pic_email} onChange={(e) => setEditForm((f) => ({ ...f, pic_email: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelClass}>Telepon PIC</label>
                    <input className={inputClass} value={editForm.pic_telepon} onChange={(e) => setEditForm((f) => ({ ...f, pic_telepon: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div>
                <label className={labelClass}>Assigned To (BD)</label>
                <select className={inputClass} value={editForm.assigned_to} onChange={(e) => setEditForm((f) => ({ ...f, assigned_to: e.target.value }))}>
                  <option value="">-</option>
                  {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.nama}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Catatan</label>
                <textarea className={inputClass} rows={3} value={editForm.catatan} onChange={(e) => setEditForm((f) => ({ ...f, catatan: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 text-sm text-[#6B6B6B] border border-[#E0E0E0] bg-white cursor-pointer">Batal</button>
                <button type="submit" disabled={savingEdit} className="px-4 py-2 text-sm font-medium text-white bg-madael-red hover:bg-madael-dark cursor-pointer border-0 disabled:opacity-60">
                  {savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Ganti Stage */}
      {showStageModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-4">
          <div className="bg-white w-full max-w-[380px]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E0E0E0]">
              <h2 className="font-serif text-lg text-black">Ganti Stage</h2>
              <button onClick={() => setShowStageModal(false)} className="text-[#6B6B6B] hover:text-black cursor-pointer border-0 bg-transparent"><X size={18} /></button>
            </div>
            <form onSubmit={handleStageSubmit} className="px-6 py-5 flex flex-col gap-4">
              <select className={inputClass} value={stageDraft} onChange={(e) => setStageDraft(e.target.value)}>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowStageModal(false)} className="px-4 py-2 text-sm text-[#6B6B6B] border border-[#E0E0E0] bg-white cursor-pointer">Batal</button>
                <button type="submit" disabled={savingStage} className="px-4 py-2 text-sm font-medium text-white bg-madael-red hover:bg-madael-dark cursor-pointer border-0 disabled:opacity-60">
                  {savingStage ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tambah Aktivitas */}
      {showActivityModal && activityForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-4">
          <div className="bg-white w-full max-w-[480px] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E0E0E0] sticky top-0 bg-white">
              <h2 className="font-serif text-lg text-black">Tambah Aktivitas</h2>
              <button onClick={() => setShowActivityModal(false)} className="text-[#6B6B6B] hover:text-black cursor-pointer border-0 bg-transparent"><X size={18} /></button>
            </div>
            <form onSubmit={handleActivitySubmit} className="px-6 py-5 flex flex-col gap-4">
              <div>
                <label className={labelClass}>Tipe</label>
                <select className={inputClass} value={activityForm.tipe} onChange={(e) => setActivityForm((f) => ({ ...f, tipe: e.target.value }))}>
                  {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Judul</label>
                <input className={inputClass} value={activityForm.judul} onChange={(e) => setActivityForm((f) => ({ ...f, judul: e.target.value }))} />
              </div>
              <div>
                <label className={labelClass}>Deskripsi</label>
                <textarea className={inputClass} rows={3} value={activityForm.deskripsi} onChange={(e) => setActivityForm((f) => ({ ...f, deskripsi: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Tanggal</label>
                  <input type="date" className={inputClass} value={activityForm.tanggal} onChange={(e) => setActivityForm((f) => ({ ...f, tanggal: e.target.value }))} required />
                </div>
                <div>
                  <label className={labelClass}>Follow-up (opsional)</label>
                  <input type="date" className={inputClass} value={activityForm.follow_up_date} onChange={(e) => setActivityForm((f) => ({ ...f, follow_up_date: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowActivityModal(false)} className="px-4 py-2 text-sm text-[#6B6B6B] border border-[#E0E0E0] bg-white cursor-pointer">Batal</button>
                <button type="submit" disabled={savingActivity} className="px-4 py-2 text-sm font-medium text-white bg-madael-red hover:bg-madael-dark cursor-pointer border-0 disabled:opacity-60">
                  {savingActivity ? 'Menyimpan...' : 'Simpan Aktivitas'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tambah Project */}
      {showProjectModal && projectForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-4">
          <div className="bg-white w-full max-w-[480px] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E0E0E0] sticky top-0 bg-white">
              <h2 className="font-serif text-lg text-black">Tambah Project</h2>
              <button onClick={() => setShowProjectModal(false)} className="text-[#6B6B6B] hover:text-black cursor-pointer border-0 bg-transparent"><X size={18} /></button>
            </div>
            <form onSubmit={handleProjectSubmit} className="px-6 py-5 flex flex-col gap-4">
              <div>
                <label className={labelClass}>Nama Project *</label>
                <input className={inputClass} value={projectForm.nama_project} onChange={(e) => setProjectForm((f) => ({ ...f, nama_project: e.target.value }))} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Jenis Layanan</label>
                  <select className={inputClass} value={projectForm.jenis_layanan} onChange={(e) => setProjectForm((f) => ({ ...f, jenis_layanan: e.target.value }))}>
                    <option value="">-</option>
                    {JENIS_LAYANAN_OPTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select className={inputClass} value={projectForm.status} onChange={(e) => setProjectForm((f) => ({ ...f, status: e.target.value }))}>
                    {PROJECT_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>Nilai Kontrak (Rp)</label>
                <input type="number" className={inputClass} value={projectForm.nilai_kontrak} onChange={(e) => setProjectForm((f) => ({ ...f, nilai_kontrak: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Tanggal Mulai</label>
                  <input type="date" className={inputClass} value={projectForm.tanggal_mulai} onChange={(e) => setProjectForm((f) => ({ ...f, tanggal_mulai: e.target.value }))} />
                </div>
                <div>
                  <label className={labelClass}>Tanggal Selesai</label>
                  <input type="date" className={inputClass} value={projectForm.tanggal_selesai} onChange={(e) => setProjectForm((f) => ({ ...f, tanggal_selesai: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className={labelClass}>PIC Madael</label>
                <select className={inputClass} value={projectForm.pic_madael} onChange={(e) => setProjectForm((f) => ({ ...f, pic_madael: e.target.value }))}>
                  <option value="">-</option>
                  {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.nama}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Catatan</label>
                <textarea className={inputClass} rows={2} value={projectForm.catatan} onChange={(e) => setProjectForm((f) => ({ ...f, catatan: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowProjectModal(false)} className="px-4 py-2 text-sm text-[#6B6B6B] border border-[#E0E0E0] bg-white cursor-pointer">Batal</button>
                <button type="submit" disabled={savingProject} className="px-4 py-2 text-sm font-medium text-white bg-madael-red hover:bg-madael-dark cursor-pointer border-0 disabled:opacity-60">
                  {savingProject ? 'Menyimpan...' : 'Simpan Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
