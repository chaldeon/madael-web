'use client';

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowUp, ArrowDown, ArrowUpDown, CalendarClock, X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { notifyEmployee } from '@/lib/notify';

const STATUS_OPTIONS = ['Baru', 'Review', 'Interview', 'Ditolak', 'Diterima'];

const STATUS_STYLES = {
  Baru: 'bg-[#E8F0FE] text-[#1A56DB]',
  Review: 'bg-[#FEF3C7] text-[#92700C]',
  Interview: 'bg-[#DCFCE7] text-[#166534]',
  Ditolak: 'bg-[#FEE2E2] text-[#B91C1C]',
  Diterima: 'bg-[#166534] text-white',
};

function CvLink({ driveId }) {
  const url = "https://drive.google.com/file/d/" + driveId + "/view";
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-madael-red hover:text-madael-dark text-xs font-medium">
      Lihat CV
    </a>
  );
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Kolom yang bisa disortir — pola sama seperti app/employee/list.
const SORT_COLUMNS = {
  nama: { get: (a) => (a.nama || '').toLowerCase() },
  posisi: { get: (a) => (a.job_listings?.title || 'CV Umum').toLowerCase() },
  tanggal: { get: (a) => new Date(a.created_at).getTime() },
  status: { get: (a) => a.status || '' },
};

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

export default function JobPortalCandidatesPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const posisiParam = searchParams.get('posisi') || '';

  const [applications, setApplications] = useState([]);
  const [jobOptions, setJobOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterJob, setFilterJob] = useState(posisiParam);
  const [filterStatus, setFilterStatus] = useState('');
  const [updatingId, setUpdatingId] = useState(null);
  const [catatanDrafts, setCatatanDrafts] = useState({});
  const [savingCatatanId, setSavingCatatanId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [sortField, setSortField] = useState('tanggal');
  const [sortDir, setSortDir] = useState('desc');

  // --- Jadwal interview ---
  const [interviewers, setInterviewers] = useState([]); // karyawan pemegang akses modul job_portal
  const [schedulingApp, setSchedulingApp] = useState(null); // application yang lagi dijadwalkan
  const [scheduleForm, setScheduleForm] = useState({ interview_at: '', interview_interviewer_id: '', interview_location: '' });
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);

  // Sinkronkan filter dengan query param ?posisi= (mis. dari klik jumlah pelamar di halaman Lowongan)
  useEffect(() => {
    setFilterJob(posisiParam);
  }, [posisiParam]);

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from('applications')
      .select(
        'id, created_at, nama, email, telepon, status, cv_drive_id, cv_filename, job_id, catatan, answers, interview_at, interview_interviewer_id, interview_location, job_listings ( title, slug ), interviewer:interview_interviewer_id ( nama )'
      )
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setApplications(data || []);
      setCatatanDrafts(Object.fromEntries((data || []).map((a) => [a.id, a.catatan || ''])));
      const uniqueJobs = new Map();
      (data || []).forEach((a) => {
        if (a.job_listings?.slug) uniqueJobs.set(a.job_listings.slug, a.job_listings.title);
      });
      setJobOptions(Array.from(uniqueJobs, ([slug, title]) => ({ slug, title })));
    }
    setLoading(false);
  }, [supabase]);

  // Daftar interviewer = karyawan pemegang akses modul job_portal + superadmin
  // (superadmin selalu punya akses ke semua modul).
  const fetchInterviewers = useCallback(async () => {
    const [modsRes, adminsRes] = await Promise.all([
      supabase.from('employee_modules').select('employee_id, employees:employee_id ( id, nama, status )').eq('module_name', 'job_portal'),
      supabase.from('employees').select('id, nama, status').eq('is_superadmin', true),
    ]);

    const byId = new Map();
    (modsRes.data || []).forEach((m) => {
      const e = m.employees;
      if (e && e.status === 'Aktif') byId.set(e.id, e.nama);
    });
    (adminsRes.data || []).forEach((a) => {
      if (a.status === 'Aktif') byId.set(a.id, a.nama);
    });

    setInterviewers(Array.from(byId, ([id, nama]) => ({ id, nama })).sort((a, b) => a.nama.localeCompare(b.nama)));
  }, [supabase]);

  useEffect(() => {
    fetchApplications();
    fetchInterviewers();
  }, [fetchApplications, fetchInterviewers]);

  const handleStatusChange = async (id, newStatus) => {
    setUpdatingId(id);
    const { error } = await supabase.from('applications').update({ status: newStatus }).eq('id', id);

    if (!error) {
      let updatedApp = null;
      setApplications((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          updatedApp = { ...a, status: newStatus };
          return updatedApp;
        })
      );
      // Begitu status masuk "Interview" dan belum ada jadwal, langsung buka
      // form jadwal — memudahkan alur, tidak perlu klik "Jadwalkan" lagi.
      if (newStatus === 'Interview' && updatedApp && !updatedApp.interview_at) {
        openScheduleModal(updatedApp);
      }
    } else {
      alert('Gagal update status: ' + error.message);
    }
    setUpdatingId(null);
  };

  const handleCatatanBlur = async (id) => {
    const original = applications.find((a) => a.id === id)?.catatan || '';
    const draft = catatanDrafts[id] ?? '';
    if (draft === original) return;

    setSavingCatatanId(id);
    const { error } = await supabase.from('applications').update({ catatan: draft }).eq('id', id);

    if (!error) {
      setApplications((prev) => prev.map((a) => (a.id === id ? { ...a, catatan: draft } : a)));
    } else {
      alert('Gagal menyimpan catatan: ' + error.message);
    }
    setSavingCatatanId(null);
  };

  const openScheduleModal = (app) => {
    if (app.status !== 'Interview') return; // jaga-jaga — tombolnya sendiri sudah dikunci di UI
    setScheduleError(null);
    setSchedulingApp(app);
    setScheduleForm({
      // input datetime-local butuh format "YYYY-MM-DDTHH:mm" tanpa detik/timezone
      interview_at: app.interview_at ? new Date(app.interview_at).toISOString().slice(0, 16) : '',
      interview_interviewer_id: app.interview_interviewer_id || '',
      interview_location: app.interview_location || '',
    });
  };

  const handleSaveSchedule = async () => {
    if (!schedulingApp) return;
    if (!scheduleForm.interview_at || !scheduleForm.interview_interviewer_id) {
      setScheduleError('Tanggal/jam dan interviewer wajib diisi.');
      return;
    }

    setScheduleSaving(true);
    setScheduleError(null);

    const payload = {
      interview_at: new Date(scheduleForm.interview_at).toISOString(),
      interview_interviewer_id: scheduleForm.interview_interviewer_id,
      interview_location: scheduleForm.interview_location || null,
      // Otomatis pindahkan status ke "Interview" kalau belum, biar sinkron
      // dengan jadwal yang baru diisi — bisa diubah manual lagi kalau perlu.
      status: schedulingApp.status === 'Interview' ? schedulingApp.status : 'Interview',
    };

    const { data, error } = await supabase
      .from('applications')
      .update(payload)
      .eq('id', schedulingApp.id)
      .select('id, status, interview_at, interview_interviewer_id, interview_location, interviewer:interview_interviewer_id ( nama )')
      .single();

    if (error) {
      setScheduleError(error.message || 'Gagal menyimpan jadwal interview.');
      setScheduleSaving(false);
      return;
    }

    setApplications((prev) => prev.map((a) => (a.id === data.id ? { ...a, ...data } : a)));

    const interviewLabel = schedulingApp.job_listings?.title || 'CV Umum';
    await notifyEmployee(supabase, {
      userId: payload.interview_interviewer_id,
      tipe: 'interview_dijadwalkan',
      pesan: `Kamu dijadwalkan jadi interviewer untuk ${schedulingApp.nama} (${interviewLabel}) pada ${new Date(payload.interview_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}.`,
      link: '/employee/job-portal/pelamar',
    });

    setScheduleSaving(false);
    setSchedulingApp(null);
  };

  const filtered = useMemo(() => {
    const base = applications.filter((a) => {
      const matchJob = !filterJob || (filterJob === 'umum' ? !a.job_id : a.job_listings?.slug === filterJob);
      const matchStatus = !filterStatus || a.status === filterStatus;
      return matchJob && matchStatus;
    });

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
  }, [applications, filterJob, filterStatus, sortField, sortDir]);

  const handleSort = (colKey) => {
    if (sortField === colKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(colKey);
      setSortDir('asc');
    }
  };

  const handleExportCsv = () => {
    const header = ['Nama', 'Email', 'Telepon', 'Posisi', 'Tanggal Apply', 'Status', 'Catatan', 'Link CV'];
    const rows = filtered.map((a) => [
      a.nama,
      a.email,
      a.telepon || '',
      a.job_listings?.title || 'CV Umum',
      new Date(a.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
      a.status,
      catatanDrafts[a.id] ?? a.catatan ?? '',
      a.cv_drive_id ? `https://drive.google.com/file/d/${a.cv_drive_id}/view` : '',
    ]);

    const csvContent = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kandidat-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  const activeFilterLabel =
    filterJob === 'umum' ? 'Umum' : jobOptions.find((j) => j.slug === filterJob)?.title || null;

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-10">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Semua Pelamar</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">{applications.length} total pelamar</p>
        </div>
        <button
          onClick={handleExportCsv}
          disabled={filtered.length === 0}
          className="border border-madael-red text-madael-red px-5 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-red hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Export CSV
        </button>
      </div>

      {posisiParam && activeFilterLabel && (
        <div className="flex items-center gap-3 mb-6 text-sm text-[#3D3D3D]">
          <span>
            Menampilkan pelamar untuk: <span className="font-medium text-black">{activeFilterLabel}</span>
          </span>
          <Link href="/employee/job-portal/pelamar" className="text-madael-red hover:text-madael-dark text-xs font-medium">
            × Lihat semua pelamar
          </Link>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-6">
        <select value={filterJob} onChange={(e) => setFilterJob(e.target.value)} className={selectClass}>
          <option value="">Semua Posisi</option>
          <option value="umum">Umum (tanpa posisi spesifik)</option>
          {jobOptions.map((job) => (
            <option key={job.slug} value={job.slug}>{job.title}</option>
          ))}
        </select>

        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={selectClass}>
          <option value="">Semua Status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
        {loading ? (
          <p className="text-sm text-[#6B6B6B] p-6">Memuat data...</p>
        ) : error ? (
          <p className="text-sm text-madael-red p-6">Gagal memuat data: {error}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-[#6B6B6B] p-6">Tidak ada pelamar yang cocok dengan filter.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B] tracking-[0.04em]">
                <SortableHeader colKey="nama" label="Nama" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="posisi" label="Posisi" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader colKey="tanggal" label="Tanggal Apply" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-medium">Kontak</th>
                <th className="px-5 py-3 font-medium">CV</th>
                <th className="px-5 py-3 font-medium">Jawaban</th>
                <th className="px-5 py-3 font-medium">Catatan</th>
                <SortableHeader colKey="status" label="Status" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                <th className="px-5 py-3 font-medium">Interview</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const hasAnswers = Array.isArray(a.answers) && a.answers.length > 0;
                const isExpanded = expandedId === a.id;
                return (
                  <Fragment key={a.id}>
                    <tr className="border-b border-[#F0F0F0] last:border-0 align-top">
                      <td className="px-5 py-3.5 text-black">{a.nama}</td>
                      <td className="px-5 py-3.5 text-[#3D3D3D]">{a.job_listings?.title || 'CV Umum'}</td>
                      <td className="px-5 py-3.5 text-[#6B6B6B]">
                        {new Date(a.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-5 py-3.5 text-[#6B6B6B]">
                        <div>{a.email}</div>
                        {a.telepon && <div className="text-xs">{a.telepon}</div>}
                      </td>
                      <td className="px-5 py-3.5">
                        {a.cv_drive_id ? <CvLink driveId={a.cv_drive_id} /> : <span className="text-xs text-[#AAA]">—</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        {hasAnswers ? (
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : a.id)}
                            className="text-xs font-medium text-madael-red hover:text-madael-dark"
                          >
                            {isExpanded ? 'Tutup' : `Lihat (${a.answers.length})`}
                          </button>
                        ) : (
                          <span className="text-xs text-[#AAA]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 min-w-[180px]">
                        <textarea
                          value={catatanDrafts[a.id] ?? ''}
                          onChange={(e) => setCatatanDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))}
                          onBlur={() => handleCatatanBlur(a.id)}
                          disabled={savingCatatanId === a.id}
                          rows={2}
                          placeholder="Tambah catatan..."
                          className="w-full border border-[#E0E0E0] px-2 py-1.5 text-xs text-black bg-white focus:outline-none focus:border-madael-red transition-colors resize-y"
                        />
                      </td>
                      <td className="px-5 py-3.5">
                        <select
                          value={a.status}
                          disabled={updatingId === a.id}
                          onChange={(e) => handleStatusChange(a.id, e.target.value)}
                          className={`text-xs font-medium px-2.5 py-1.5 border-0 focus:outline-none cursor-pointer ${STATUS_STYLES[a.status] || 'bg-[#F4F4F4] text-[#3D3D3D]'}`}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-5 py-3.5 min-w-[160px]">
                        {a.interview_at ? (
                          <div className="text-xs text-[#3D3D3D]">
                            <div className="font-medium text-black">
                              {new Date(a.interview_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                            </div>
                            <div>{a.interviewer?.nama || '—'}</div>
                            {a.interview_location && <div className="text-[#9A9A9A]">{a.interview_location}</div>}
                            {a.status === 'Interview' ? (
                              <button
                                onClick={() => openScheduleModal(a)}
                                className="text-madael-red hover:text-madael-dark font-medium mt-1"
                              >
                                Ubah jadwal
                              </button>
                            ) : (
                              <span className="text-[#B0B0B0] mt-1 block">
                                Terkunci — status sudah &quot;{a.status}&quot;
                              </span>
                            )}
                          </div>
                        ) : a.status === 'Interview' ? (
                          <button
                            onClick={() => openScheduleModal(a)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-madael-red hover:text-madael-dark"
                          >
                            <CalendarClock size={13} /> Jadwalkan
                          </button>
                        ) : (
                          <span
                            title='Ubah status ke "Interview" dulu untuk bisa menjadwalkan'
                            className="inline-flex items-center gap-1.5 text-xs text-[#C4C4C4] cursor-not-allowed"
                          >
                            <CalendarClock size={13} /> Jadwalkan
                          </span>
                        )}
                      </td>
                    </tr>

                    {hasAnswers && (
                      <tr>
                        <td colSpan={9} className="p-0 border-b border-[#F0F0F0] last:border-0">
                          <div
                            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                              isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                            }`}
                          >
                            <div className="overflow-hidden bg-[#FAFAFA]">
                              <div className="px-8 py-5 space-y-2.5">
                                {a.answers.map((qa, i) => (
                                  <div key={i} className="text-xs">
                                    <span className="text-[#6B6B6B]">{qa.question}</span>
                                    <p className="text-black mt-0.5">{qa.answer || '—'}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {schedulingApp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6" onClick={() => setSchedulingApp(null)}>
          <div className="bg-white w-full max-w-[420px] p-6 relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setSchedulingApp(null)} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black">
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-1">Jadwalkan Interview</h2>
            <p className="text-xs text-[#6B6B6B] mb-4">{schedulingApp.nama} — {schedulingApp.job_listings?.title || 'CV Umum'}</p>

            {scheduleError && <p className="text-xs text-red-600 mb-3">{scheduleError}</p>}

            <label className="flex flex-col gap-1 mb-3">
              <span className="text-xs text-[#6B6B6B]">Tanggal & Jam</span>
              <input
                type="datetime-local"
                value={scheduleForm.interview_at}
                onChange={(e) => setScheduleForm((f) => ({ ...f, interview_at: e.target.value }))}
                className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
              />
            </label>

            <label className="flex flex-col gap-1 mb-3">
              <span className="text-xs text-[#6B6B6B]">Interviewer</span>
              <select
                value={scheduleForm.interview_interviewer_id}
                onChange={(e) => setScheduleForm((f) => ({ ...f, interview_interviewer_id: e.target.value }))}
                className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
              >
                <option value="">Pilih interviewer...</option>
                {interviewers.map((i) => (
                  <option key={i.id} value={i.id}>{i.nama}</option>
                ))}
              </select>
              {interviewers.length === 0 && (
                <span className="text-[11px] text-[#9A9A9A]">Belum ada karyawan dengan akses modul Job Portal.</span>
              )}
            </label>

            <label className="flex flex-col gap-1 mb-5">
              <span className="text-xs text-[#6B6B6B]">Lokasi / Link Meeting (opsional)</span>
              <input
                value={scheduleForm.interview_location}
                onChange={(e) => setScheduleForm((f) => ({ ...f, interview_location: e.target.value }))}
                placeholder="Kantor Pusat / link Zoom / Google Meet"
                className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
              />
            </label>

            <button
              onClick={handleSaveSchedule}
              disabled={scheduleSaving}
              className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {scheduleSaving ? 'Menyimpan...' : 'Simpan Jadwal'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}