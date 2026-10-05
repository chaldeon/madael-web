'use client';

import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowUp, ArrowDown, ArrowUpDown, CalendarClock, ChevronDown, Clock, MessageSquare, Plus, Search, Send, X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { JOB_PORTAL_KEYS, isJobPortalScoped } from '@/lib/jobPortalAccess';
import {
  APPLICATION_STATUSES,
  REJECTION_REASON_OTHER,
  REJECTION_REASON_PRESETS,
  buildRejectionReason,
} from '@/lib/applicationStatus';
import CvPreviewModal from '@/components/CvPreviewModal';
import BulkApplicantActions from '@/components/job-portal/BulkApplicantActions';
import { findDuplicateApplications } from '@/lib/candidateDuplicates';
import { MAX_TAG_LENGTH, normalizeTags } from '@/lib/talentPoolTags';
import {
  MESSAGE_TEMPLATES,
  TEMPLATE_STATUS,
  buildWaLink,
  buildWhatsAppText,
  getTemplateLabel,
  normalizeWaNumber,
  statusToTemplate,
  INTERVIEW_MODES,
  getInterviewVenue,
  hasInterviewVenue,
  isHttpUrl,
} from '@/lib/candidateMessages';

const STATUS_OPTIONS = APPLICATION_STATUSES;

const STATUS_STYLES = {
  Baru: 'bg-[#E8F0FE] text-[#1A56DB]',
  Review: 'bg-[#FEF3C7] text-[#92700C]',
  Interview: 'bg-[#DCFCE7] text-[#166534]',
  Ditolak: 'bg-[#FEE2E2] text-[#B91C1C]',
  Diterima: 'bg-[#166534] text-white',
};

// Riwayat pesan ke kandidat (tabel application_messages)
const CHANNEL_LABEL = { email: 'Email', whatsapp: 'WhatsApp' };
const MSG_STATUS_LABEL = {
  terkirim: 'Terkirim',
  gagal: 'Gagal terkirim',
  wa_dibuka: 'WhatsApp dibuka — belum dikonfirmasi',
  wa_terkirim: 'Terkirim (dikonfirmasi HR)',
};
const MSG_STATUS_STYLE = {
  terkirim: 'bg-[#DCFCE7] text-[#166534]',
  gagal: 'bg-[#FEE2E2] text-[#B91C1C]',
  wa_dibuka: 'bg-[#FEF3C7] text-[#92700C]',
  wa_terkirim: 'bg-[#DCFCE7] text-[#166534]',
};

// Ringkasan format + lokasi interview di kolom Jadwal.
function InterviewVenue({ app }) {
  const v = getInterviewVenue(app);
  if (v.mode === 'online') {
    return (
      <div className="text-[#9A9A9A]">
        Online
        {isHttpUrl(v.meetingUrl) && (
          <>
            {' · '}
            <a
              href={v.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-madael-red hover:text-madael-dark"
            >
              Buka link
            </a>
          </>
        )}
      </div>
    );
  }
  if (!v.location && !v.address) return null;
  return (
    <div className="text-[#9A9A9A]">
      {v.location && <div>{v.location}</div>}
      {v.address && (
        <div className="line-clamp-2 whitespace-pre-line" title={v.address}>
          {v.address}
        </div>
      )}
    </div>
  );
}

function CvLink({ onOpen }) {
  return (
    <button type="button" onClick={onOpen} className="text-madael-red hover:text-madael-dark text-xs font-medium">
      Lihat CV
    </button>
  );
}

// Petunjuk bahwa email/telepon pelamar ini sama dengan lamaran lain (mis. melamar
// ke beberapa posisi). Hanya petunjuk — bisa saja bukan orang yang sama.
// Kolom Nama sempit, jadi di sel hanya ada badge kecil; detailnya tampil di baris
// selebar tabel (DuplicatePanel) saat badge diklik.
const DUPLICATE_FIELD_LABEL = { email: 'email', telepon: 'telepon' };

function DuplicateBadge({ count, open, onToggle }) {
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={`Kemungkinan pelamar ganda — email/telepon sama dengan ${count} lamaran lain. Klik untuk ${open ? 'menutup' : 'melihat'} detail.`}
        className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] font-medium px-1.5 py-0.5 bg-[#FEF3C7] text-[#92700C] hover:bg-[#FDE68A] transition-colors"
      >
        Ganda · {count}
        <ChevronDown size={11} className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
}

function DuplicatePanel({ duplicates }) {
  return (
    <div className="px-8 py-4">
      <p className="text-xs font-medium text-[#92700C] mb-2.5">
        Email atau nomor telepon sama dengan lamaran berikut — kemungkinan kandidat yang sama
      </p>
      <ul className="space-y-2">
        {duplicates.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#3D3D3D]">
            <span className="font-medium text-black">{d.jobTitle}</span>
            {d.sameJob && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 bg-[#F4F4F4] text-[#6B6B6B]">Posisi sama</span>
            )}
            <span className="text-[#6B6B6B]">
              {new Date(d.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 ${STATUS_STYLES[d.status] || 'bg-[#F4F4F4] text-[#3D3D3D]'}`}
            >
              {d.status}
            </span>
            <span className="text-[#9A9A9A]">
              cocok: {d.matchedBy.map((f) => DUPLICATE_FIELD_LABEL[f] || f).join(' & ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Tag manual kandidat talent pool. Klik nama tag = filter daftar dengan tag itu.
// onAdd / onRemove mengembalikan teks error, atau null kalau berhasil.
function TagEditor({ tags, activeTag, searchTerms, busy, onFilter, onAdd, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);

  const run = async (action) => {
    setError(null);
    const err = await action();
    if (err) setError(err);
    return !err;
  };

  const submit = async () => {
    const raw = draft.trim();
    if (!raw) {
      setEditing(false);
      return;
    }
    if (await run(() => onAdd(raw))) setDraft(''); // form tetap terbuka untuk tag berikutnya
  };

  return (
    <div className="mt-1.5 max-w-[260px]">
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((t) => (
          <span
            key={t}
            className={`inline-flex items-center text-[10px] font-medium ${
              t === activeTag ? 'bg-madael-red text-white' : 'bg-[#F4F4F4] text-[#3D3D3D]'
            }`}
          >
            <button
              type="button"
              onClick={() => onFilter(t === activeTag ? '' : t)}
              title="Tampilkan kandidat dengan tag ini"
              className="pl-1.5 py-0.5 hover:underline"
            >
              {highlightText(t, searchTerms)}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => onRemove(t))}
              aria-label={`Hapus tag ${t}`}
              className="px-1 py-0.5 opacity-60 hover:opacity-100 disabled:opacity-30"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-0.5 text-[10px] font-medium text-madael-red hover:text-madael-dark"
          >
            <Plus size={11} /> Tag
          </button>
        )}
      </div>
      {editing && (
        <input
          autoFocus
          type="text"
          list="talent-pool-tags"
          value={draft}
          disabled={busy}
          maxLength={MAX_TAG_LENGTH * 4}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              setDraft('');
              setError(null);
              setEditing(false);
            }
          }}
          onBlur={() => {
            if (!draft.trim()) {
              setError(null);
              setEditing(false);
            }
          }}
          placeholder="mis. excel, sales + Enter"
          className="mt-1 w-full border border-[#E0E0E0] px-2 py-1 text-[11px] text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
        />
      )}
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
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

const formatWaktu = (value) =>
  new Date(value).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

// Catatan terbaru di atas.
const getNotes = (a) =>
  [...(a.application_notes || [])].sort((x, y) => new Date(y.created_at) - new Date(x.created_at));

// Untuk CSV: urut kronologis, catatan lama (kolom `catatan`) di paling depan.
function notesForCsv(a) {
  const lines = [...(a.application_notes || [])]
    .sort((x, y) => new Date(x.created_at) - new Date(y.created_at))
    .map((n) => {
      const tgl = new Date(n.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
      return `[${tgl}] ${n.author_nama}: ${n.isi}`;
    });
  if (a.catatan) lines.unshift(a.catatan);
  return lines.join('\n');
}

// --- Pencarian ---
const normalizeText = (v) => String(v ?? '').toLowerCase();
const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Bungkus bagian teks yang cocok dengan kata kunci pakai <mark>.
function highlightText(text, terms) {
  const str = String(text ?? '');
  if (!str || terms.length === 0) return str;
  const pattern = new RegExp('(' + terms.map(escapeRegExp).join('|') + ')', 'gi');
  // split dengan capture group: indeks ganjil = potongan yang cocok
  return str.split(pattern).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-[#FEF3C7] text-black px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInAnswers, setSearchInAnswers] = useState(true);
  // Tag talent pool (lamaran umum). Dimuat terpisah dari daftar pelamar supaya
  // halaman tetap jalan kalau migrasi kolom `tags` belum dijalankan.
  const [filterTag, setFilterTag] = useState('');
  const [tagsById, setTagsById] = useState({});
  const [tagsLoadError, setTagsLoadError] = useState(null);
  const [tagBusyId, setTagBusyId] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  // Penolakan wajib beralasan: modal alasan dibuka saat status diubah ke "Ditolak".
  const [rejectApp, setRejectApp] = useState(null);
  const [rejectPreset, setRejectPreset] = useState('');
  const [rejectDetail, setRejectDetail] = useState('');
  const [rejectSaving, setRejectSaving] = useState(false);
  const [rejectError, setRejectError] = useState(null);
  // Riwayat perubahan status (timeline) satu pelamar, dimuat saat modal dibuka.
  const [historyApp, setHistoryApp] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const historyAppIdRef = useRef(null); // buang respons basi kalau modal sudah ganti/tutup
  // Status sudah berubah tetapi riwayatnya gagal tersimpan (mis. migrasi SQL belum dijalankan).
  const [historyWarning, setHistoryWarning] = useState(null);
  // Akses penuh melihat semua pelamar; reviewer terbatas (job_portal_assigned)
  // hanya pelamar dari lowongan yang di-assign ke dia.
  const { status: accessStatus, employee, moduleKeys } = useModuleAccess(JOB_PORTAL_KEYS);
  const scoped = isJobPortalScoped(employee, moduleKeys);
  const employeeId = employee?.id || null;
  const employeeNama = employee?.nama || null;
  const [notesAppId, setNotesAppId] = useState(null);
  const [cvApp, setCvApp] = useState(null); // pelamar yang CV-nya sedang dipreview
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [dupExpandedId, setDupExpandedId] = useState(null); // lamaran yang detail pelamar gandanya dibuka
  const [sortField, setSortField] = useState('tanggal');
  const [sortDir, setSortDir] = useState('desc');
  // Pilihan untuk aksi massal (id lamaran). Yang diproses hanya yang sedang tampil.
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // --- Jadwal interview ---
  // Kandidat interviewer: pemegang akses penuh + superadmin (boleh untuk lowongan
  // mana pun) dan reviewer terbatas (hanya untuk lowongan yang di-assign ke mereka).
  const [interviewerPool, setInterviewerPool] = useState({ full: [], scoped: [], reviewerMap: {} });
  const [schedulingApp, setSchedulingApp] = useState(null); // application yang lagi dijadwalkan
  const [scheduleForm, setScheduleForm] = useState({
    interview_at: '',
    interview_interviewer_id: '',
    interview_mode: 'offline',
    interview_location: '',
    interview_address: '',
    interview_meeting_url: '',
  });
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);

  // Sinkronkan filter dengan query param ?posisi= (mis. dari klik jumlah pelamar di halaman Lowongan)
  useEffect(() => {
    setFilterJob(posisiParam);
  }, [posisiParam]);

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Reviewer terbatas: batasi ke lowongan yang di-assign. RLS di database juga
    // menegakkan ini; filter di sini supaya halaman tetap benar meski policy
    // belum terpasang.
    let assignedIds = null;
    if (scoped) {
      const { data: mine, error: mineError } = await supabase
        .from('job_listing_reviewers')
        .select('job_id')
        .eq('employee_id', employeeId);
      if (mineError) {
        setError(mineError.message);
        setLoading(false);
        return;
      }
      assignedIds = (mine || []).map((r) => r.job_id);
      if (assignedIds.length === 0) {
        setApplications([]);
        setJobOptions([]);
        setLoading(false);
        return;
      }
    }

    let query = supabase
      .from('applications')
      .select(
        'id, created_at, nama, email, telepon, status, cv_drive_id, cv_filename, job_id, catatan, answers, interview_at, interview_interviewer_id, interview_mode, interview_location, interview_address, interview_meeting_url, job_listings ( title, slug ), interviewer:interview_interviewer_id ( nama ), application_notes ( id, isi, author_nama, created_at )'
      )
      .order('created_at', { ascending: false });
    if (assignedIds) query = query.in('job_id', assignedIds);
    const { data, error } = await query;

    if (error) {
      setError(error.message);
    } else {
      setApplications(data || []);
      const uniqueJobs = new Map();
      (data || []).forEach((a) => {
        if (a.job_listings?.slug) uniqueJobs.set(a.job_listings.slug, a.job_listings.title);
      });
      setJobOptions(Array.from(uniqueJobs, ([slug, title]) => ({ slug, title })));
    }
    setLoading(false);
  }, [supabase, scoped, employeeId]);

  // Tag hanya ada untuk lamaran umum dan hanya dikelola akses penuh.
  const fetchTags = useCallback(async () => {
    if (scoped) {
      setTagsById({});
      setTagsLoadError(null);
      return;
    }
    const { data, error } = await supabase.from('applications').select('id, tags').is('job_id', null);
    if (error) {
      setTagsLoadError(error.message);
      return;
    }
    setTagsLoadError(null);
    setTagsById(Object.fromEntries((data || []).map((row) => [row.id, normalizeTags(row.tags)])));
  }, [supabase, scoped]);

  // Daftar interviewer = pemegang akses penuh (job_portal) + superadmin, ditambah
  // reviewer terbatas yang di-assign ke lowongan lamaran bersangkutan.
  const fetchInterviewers = useCallback(async () => {
    const [modsRes, adminsRes, reviewersRes] = await Promise.all([
      supabase
        .from('employee_modules')
        .select('module_name, employees:employee_id ( id, nama, status )')
        .in('module_name', JOB_PORTAL_KEYS),
      supabase.from('employees').select('id, nama, status').eq('is_superadmin', true),
      supabase.from('job_listing_reviewers').select('job_id, employee_id'),
    ]);

    const full = new Map();
    const limited = new Map();
    (modsRes.data || []).forEach((m) => {
      const e = m.employees;
      if (!e || e.status !== 'Aktif') return;
      (m.module_name === 'job_portal' ? full : limited).set(e.id, e.nama);
    });
    (adminsRes.data || []).forEach((a) => {
      if (a.status === 'Aktif') full.set(a.id, a.nama);
    });
    // Reviewer terbatas yang sedang login selalu bisa memilih dirinya sendiri,
    // walau RLS membatasi daftar karyawan lain yang bisa dibaca.
    if (scoped && employeeId && employeeNama) limited.set(employeeId, employeeNama);

    const toList = (map) =>
      Array.from(map, ([id, nama]) => ({ id, nama })).sort((a, b) => a.nama.localeCompare(b.nama));

    const reviewerMap = {};
    (reviewersRes.data || []).forEach((r) => {
      (reviewerMap[r.job_id] ||= new Set()).add(r.employee_id);
    });

    setInterviewerPool({ full: toList(full), scoped: toList(limited), reviewerMap });
  }, [supabase, scoped, employeeId, employeeNama]);

  useEffect(() => {
    if (accessStatus !== 'allowed') return;
    fetchApplications();
    fetchInterviewers();
    fetchTags();
  }, [accessStatus, fetchApplications, fetchInterviewers, fetchTags]);

  // Interviewer yang boleh dipilih untuk satu lamaran.
  const interviewersFor = (app) => {
    const { full, scoped: limited, reviewerMap } = interviewerPool;
    const assigned = app?.job_id ? reviewerMap[app.job_id] : null;
    const extra = assigned ? limited.filter((i) => assigned.has(i.id)) : [];
    const byId = new Map([...full, ...extra].map((i) => [i.id, i]));
    return Array.from(byId.values()).sort((a, b) => a.nama.localeCompare(b.nama));
  };

  // Ubah status lewat route server: hak akses, riwayat, dan activity log
  // ditangani di sana. Return { error? , skipped? }.
  const requestStatusChange = async (app, newStatus, reason) => {
    if (app.status === newStatus) return { skipped: true };
    try {
      const res = await fetch(`/api/applications/${app.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json.error || 'Gagal mengubah status.' };
      if (json.warning) setHistoryWarning(json.warning);
      setApplications((prev) => prev.map((a) => (a.id === app.id ? { ...a, status: json.status || newStatus } : a)));
      return {};
    } catch {
      return { error: 'Gagal mengubah status. Periksa koneksi Anda.' };
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    const current = applications.find((a) => a.id === id);
    if (!current || current.status === newStatus) return;

    // Penolakan wajib beralasan: tanya dulu lewat modal.
    if (newStatus === 'Ditolak') {
      setRejectError(null);
      setRejectPreset('');
      setRejectDetail('');
      setRejectApp(current);
      return;
    }

    setUpdatingId(id);
    const res = await requestStatusChange(current, newStatus);
    setUpdatingId(null);
    if (res.error) {
      alert('Gagal update status: ' + res.error);
      return;
    }
    // Begitu status masuk "Interview" dan belum ada jadwal, langsung buka
    // form jadwal — memudahkan alur, tidak perlu klik "Jadwalkan" lagi.
    // Mengubah status TIDAK mengirim pesan ke pelamar; pengiriman hanya lewat
    // tombol "Pesan" (email / WhatsApp).
    if (newStatus === 'Interview' && !current.interview_at) {
      openScheduleModal({ ...current, status: newStatus });
    }
  };

  const closeRejectModal = () => {
    if (!rejectSaving) setRejectApp(null);
  };

  const handleConfirmReject = async () => {
    if (!rejectApp) return;
    const reason = buildRejectionReason(rejectPreset, rejectDetail);
    if (!reason) {
      setRejectError(rejectPreset === REJECTION_REASON_OTHER ? 'Isi keterangan alasan penolakan.' : 'Pilih alasan penolakan.');
      return;
    }
    setRejectSaving(true);
    setRejectError(null);
    const res = await requestStatusChange(rejectApp, 'Ditolak', reason);
    setRejectSaving(false);
    if (res.error) {
      setRejectError(res.error);
      return;
    }
    setRejectApp(null);
  };

  const openHistory = async (app) => {
    historyAppIdRef.current = app.id;
    setHistoryApp(app);
    setHistoryList([]);
    setHistoryError(null);
    setHistoryLoading(true);
    let list = [];
    let errMsg = null;
    try {
      const res = await fetch(`/api/applications/${app.id}/status`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) errMsg = json.error || 'Gagal memuat riwayat status.';
      else list = json.history || [];
    } catch {
      errMsg = 'Gagal memuat riwayat status. Periksa koneksi Anda.';
    }
    if (historyAppIdRef.current !== app.id) return;
    setHistoryList(list);
    setHistoryError(errMsg);
    setHistoryLoading(false);
  };

  const closeHistory = () => {
    historyAppIdRef.current = null;
    setHistoryApp(null);
  };

  // Tambah/hapus tag lewat route server. Return teks error, atau null kalau berhasil.
  const updateTags = async (id, change) => {
    setTagBusyId(id);
    try {
      const res = await fetch(`/api/applications/${id}/tags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return json.error || 'Gagal menyimpan tag.';
      setTagsById((prev) => ({ ...prev, [id]: normalizeTags(json.tags) }));
      return null;
    } catch {
      return 'Gagal menyimpan tag. Periksa koneksi Anda.';
    } finally {
      setTagBusyId(null);
    }
  };
  const handleAddTag = (id, raw) => updateTags(id, { add: raw });
  const handleRemoveTag = (id, tag) => updateTags(id, { remove: [tag] });

  const openNotes = (id) => {
    setNoteError(null);
    setNoteDraft('');
    setNotesAppId(id);
  };
  const closeNotes = () => setNotesAppId(null);

  const handleAddNote = async () => {
    const isi = noteDraft.trim();
    if (!isi || !notesAppId) return;

    setNoteSaving(true);
    setNoteError(null);

    // author_id, author_nama, created_at diisi trigger di database.
    const { data, error } = await supabase
      .from('application_notes')
      .insert([{ application_id: notesAppId, isi }])
      .select('id, isi, author_nama, created_at')
      .single();

    if (error) {
      setNoteError(error.message || 'Gagal menyimpan catatan.');
      setNoteSaving(false);
      return;
    }

    setApplications((prev) =>
      prev.map((a) =>
        a.id === notesAppId ? { ...a, application_notes: [data, ...(a.application_notes || [])] } : a
      )
    );
    setNoteDraft('');
    setNoteSaving(false);
  };

  const notesApp = notesAppId ? applications.find((a) => a.id === notesAppId) : null;
  const schedulingInterviewers = schedulingApp ? interviewersFor(schedulingApp) : [];
  const notesList = notesApp ? getNotes(notesApp) : [];

  const openScheduleModal = (app) => {
    if (app.status !== 'Interview') return; // jaga-jaga — tombolnya sendiri sudah dikunci di UI
    setScheduleError(null);
    setSchedulingApp(app);
    const venue = getInterviewVenue(app);
    setScheduleForm({
      // input datetime-local butuh format "YYYY-MM-DDTHH:mm" tanpa detik/timezone
      interview_at: app.interview_at ? new Date(app.interview_at).toISOString().slice(0, 16) : '',
      interview_interviewer_id: app.interview_interviewer_id || '',
      interview_mode: venue.mode || 'offline',
      interview_location: venue.location || '',
      interview_address: venue.address || '',
      interview_meeting_url: venue.meetingUrl || '',
    });
  };

  const handleSaveSchedule = async () => {
    if (!schedulingApp) return;
    if (!scheduleForm.interview_at || !scheduleForm.interview_interviewer_id) {
      setScheduleError('Tanggal/jam dan interviewer wajib diisi.');
      return;
    }

    // Online → link meeting wajib; offline → alamat lengkap wajib. Dua field
    // itu yang ikut terkirim ke kandidat lewat email/WhatsApp.
    const isOnline = scheduleForm.interview_mode === 'online';
    const meetingUrl = scheduleForm.interview_meeting_url.trim();
    const address = scheduleForm.interview_address.trim();
    if (isOnline && !isHttpUrl(meetingUrl)) {
      setScheduleError('Link meeting wajib diisi dan harus diawali http:// atau https://.');
      return;
    }
    if (!isOnline && !address) {
      setScheduleError('Alamat lengkap wajib diisi untuk interview offline.');
      return;
    }

    setScheduleSaving(true);
    setScheduleError(null);

    // Validasi, cek interviewer, simpan, notifikasi, dan activity log dikerjakan
    // route server; status pelamar harus sudah "Interview" (tombolnya sudah dikunci di UI).
    let json = {};
    try {
      const res = await fetch(`/api/applications/${schedulingApp.id}/interview`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interview_at: new Date(scheduleForm.interview_at).toISOString(),
          interviewer_id: scheduleForm.interview_interviewer_id,
          mode: isOnline ? 'online' : 'offline',
          location: scheduleForm.interview_location,
          address,
          meeting_url: meetingUrl,
        }),
      });
      json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setScheduleError(json.error || 'Gagal menyimpan jadwal interview.');
        setScheduleSaving(false);
        return;
      }
    } catch {
      setScheduleError('Gagal menyimpan jadwal interview. Periksa koneksi Anda.');
      setScheduleSaving(false);
      return;
    }

    const saved = json.application;
    setApplications((prev) => prev.map((a) => (a.id === saved.id ? { ...a, ...saved } : a)));

    setScheduleSaving(false);
    setSchedulingApp(null);
  };

  // --- Pesan ke kandidat (email otomatis + link WhatsApp) ---
  const [msgAppId, setMsgAppId] = useState(null);
  const [msgTemplate, setMsgTemplate] = useState('interview');
  const [msgChannel, setMsgChannel] = useState('email');
  const [msgHistory, setMsgHistory] = useState([]);
  const [msgHistoryLoading, setMsgHistoryLoading] = useState(false);
  const [msgHistoryError, setMsgHistoryError] = useState(null);
  const [msgSending, setMsgSending] = useState(false);
  const [msgError, setMsgError] = useState(null);
  const [msgNotice, setMsgNotice] = useState(null);
  const msgAppIdRef = useRef(null); // buang respons riwayat yang basi kalau modal sudah ganti/tutup

  const msgApp = msgAppId ? applications.find((a) => a.id === msgAppId) || null : null;

  const loadMessageHistory = useCallback(async (appId) => {
    setMsgHistoryLoading(true);
    setMsgHistoryError(null);
    let messages = [];
    let errMsg = null;
    try {
      const res = await fetch(`/api/applications/${appId}/messages`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal memuat riwayat pesan.');
      messages = json.messages || [];
    } catch (err) {
      errMsg = err.message;
    }
    if (msgAppIdRef.current !== appId) return;
    setMsgHistory(messages);
    setMsgHistoryError(errMsg);
    setMsgHistoryLoading(false);
  }, []);

  const openMessages = (app) => {
    msgAppIdRef.current = app.id;
    setMsgAppId(app.id);
    // Template awal mengikuti status sekarang; HR bisa menggantinya.
    setMsgTemplate(statusToTemplate(app.status) || 'interview');
    setMsgChannel('email');
    setMsgError(null);
    setMsgNotice(null);
    setMsgHistory([]);
    loadMessageHistory(app.id);
  };

  const closeMessages = () => {
    msgAppIdRef.current = null;
    setMsgAppId(null);
  };

  // Nilai turunan untuk modal pesan
  const msgPosisi = msgApp?.job_listings?.title || null;
  const msgVenue = msgApp ? getInterviewVenue(msgApp) : null;
  const msgNeedsSchedule = msgTemplate === 'interview' && !msgApp?.interview_at;
  // Jadwal sudah ada tapi lokasi/link belum lengkap — kandidat tidak tahu harus ke mana.
  const msgNeedsVenue = msgTemplate === 'interview' && !msgNeedsSchedule && !hasInterviewVenue(msgVenue);
  const msgBlocked = msgNeedsSchedule || msgNeedsVenue;
  const msgStatusMismatch = Boolean(msgApp) && TEMPLATE_STATUS[msgTemplate] !== msgApp.status;
  const msgWaPhone = msgApp ? normalizeWaNumber(msgApp.telepon) : null;
  const msgWaText = msgApp
    ? buildWhatsAppText(msgTemplate, {
        nama: msgApp.nama,
        posisi: msgPosisi,
        interviewAt: msgApp.interview_at,
        venue: msgVenue,
      })
    : '';
  const msgWaUrl = msgWaPhone && !msgBlocked ? buildWaLink(msgWaPhone, msgWaText) : null;

  // Template yang tidak sesuai status sekarang (mis. "Diterima" untuk pelamar
  // berstatus Review) sering salah klik — minta konfirmasi dulu.
  const confirmStatusMismatch = () =>
    !msgStatusMismatch ||
    window.confirm(
      `Status pelamar saat ini "${msgApp.status}", sedangkan template "${getTemplateLabel(msgTemplate)}" ` +
        `biasanya untuk status "${TEMPLATE_STATUS[msgTemplate]}". Tetap kirim?`
    );

  const postMessage = async (channel) => {
    const res = await fetch(`/api/applications/${msgApp.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: msgTemplate, channel }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Gagal mengirim pesan.');
    return json;
  };

  const handleSendEmail = async () => {
    if (!msgApp || msgSending || !confirmStatusMismatch()) return;
    const appId = msgApp.id;
    setMsgSending(true);
    setMsgError(null);
    setMsgNotice(null);
    try {
      const json = await postMessage('email');
      if (msgAppIdRef.current === appId) {
        if (json.message) setMsgHistory((prev) => [json.message, ...prev]);
        setMsgNotice(
          json.historyRecorded === false
            ? 'Email terkirim, tetapi gagal dicatat ke riwayat.'
            : `Email terkirim ke ${msgApp.email}.`
        );
      }
    } catch (err) {
      if (msgAppIdRef.current === appId) {
        setMsgError(err.message);
        loadMessageHistory(appId); // percobaan gagal ikut tercatat di server
      }
    }
    setMsgSending(false);
  };

  // Tombol WhatsApp adalah <a href> sungguhan (bukan window.open setelah await)
  // supaya tidak diblokir popup blocker. Pencatatan berjalan paralel saat klik.
  const handleWhatsAppClick = (e) => {
    if (!msgApp || !msgWaUrl) return;
    if (msgSending || !confirmStatusMismatch()) {
      e.preventDefault();
      return;
    }
    const appId = msgApp.id;
    setMsgSending(true);
    setMsgError(null);
    setMsgNotice(null);
    postMessage('whatsapp')
      .then((json) => {
        if (msgAppIdRef.current !== appId) return;
        if (json.message) setMsgHistory((prev) => [json.message, ...prev]);
        setMsgNotice(
          json.historyRecorded === false
            ? 'WhatsApp dibuka, tetapi gagal dicatat ke riwayat.'
            : 'WhatsApp dibuka. Setelah menekan Send di WhatsApp, klik "Sudah saya kirim" pada riwayat di bawah.'
        );
      })
      .catch((err) => {
        if (msgAppIdRef.current === appId) setMsgError('WhatsApp dibuka, tetapi tidak tercatat di riwayat: ' + err.message);
      })
      .finally(() => setMsgSending(false));
  };

  const handleConfirmWhatsApp = async (messageId) => {
    if (!msgApp) return;
    const appId = msgApp.id;
    setMsgError(null);
    try {
      const res = await fetch(`/api/applications/${appId}/messages/${messageId}`, { method: 'PATCH' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan konfirmasi.');
      if (msgAppIdRef.current === appId) {
        setMsgHistory((prev) => prev.map((m) => (m.id === messageId ? json.message : m)));
      }
    } catch (err) {
      if (msgAppIdRef.current === appId) setMsgError(err.message);
    }
  };

  // Kata kunci dipecah per spasi; semua kata harus ketemu (AND), jadi
  // "budi jakarta" bisa menemukan Budi yang jawabannya menyebut Jakarta.
  const searchTerms = useMemo(
    () => searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [searchQuery]
  );

  // Lamaran lain dengan email/telepon yang sama. Dihitung dari SEMUA lamaran yang
  // dimuat (bukan `filtered`) supaya penanda tetap muncul saat filter/pencarian aktif.
  const duplicateMap = useMemo(() => findDuplicateApplications(applications), [applications]);

  // Semua tag yang dipakai (untuk dropdown filter & saran isian), terbanyak dulu.
  const tagOptions = useMemo(() => {
    const counts = new Map();
    Object.values(tagsById).forEach((list) => list.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
      (a, b) => b.count - a.count || a.tag.localeCompare(b.tag)
    );
  }, [tagsById]);

  // Tag terakhir dihapus -> filternya otomatis tidak berlaku, supaya daftar tidak kosong tanpa alasan.
  const activeTag = tagOptions.some((o) => o.tag === filterTag) ? filterTag : '';

  // Index teks per pelamar, dibuat sekali setiap data berubah (bukan tiap ketikan).
  const searchIndex = useMemo(() => {
    const index = new Map();
    applications.forEach((a) => {
      // Lamaran umum: kolom `catatan` = posisi yang diminati, ikut dicari bersama tag.
      const general = !a.job_id;
      index.set(a.id, {
        identity: [a.nama, a.email, a.telepon, general ? a.catatan : '', ...(general ? tagsById[a.id] || [] : [])]
          .map(normalizeText)
          .join(' \n '),
        answers: Array.isArray(a.answers) ? a.answers.map((qa) => normalizeText(qa?.answer)).join(' \n ') : '',
      });
    });
    return index;
  }, [applications, tagsById]);

  const { filtered, answerOnlyIds } = useMemo(() => {
    // id pelamar yang hanya cocok lewat isi jawaban (bukan nama/email/telepon)
    const answerOnly = new Set();

    const base = applications.filter((a) => {
      const matchJob = !filterJob || (filterJob === 'umum' ? !a.job_id : a.job_listings?.slug === filterJob);
      const matchStatus = !filterStatus || a.status === filterStatus;
      const matchTag = !activeTag || (tagsById[a.id] || []).includes(activeTag);
      if (!matchJob || !matchStatus || !matchTag) return false;

      if (searchTerms.length === 0) return true;
      const entry = searchIndex.get(a.id);
      if (!entry) return false;

      if (searchTerms.every((t) => entry.identity.includes(t))) return true;
      if (!searchInAnswers) return false;

      const combined = entry.identity + ' \n ' + entry.answers;
      if (searchTerms.every((t) => combined.includes(t))) {
        answerOnly.add(a.id);
        return true;
      }
      return false;
    });

    const getValue = SORT_COLUMNS[sortField]?.get;
    if (!getValue) return { filtered: base, answerOnlyIds: answerOnly };

    const sorted = [...base].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (va < vb) return -1;
      if (va > vb) return 1;
      return 0;
    });
    return { filtered: sortDir === 'desc' ? sorted.reverse() : sorted, answerOnlyIds: answerOnly };
  }, [applications, filterJob, filterStatus, activeTag, tagsById, searchTerms, searchIndex, searchInAnswers, sortField, sortDir]);

  const handleSort = (colKey) => {
    if (sortField === colKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(colKey);
      setSortDir('asc');
    }
  };

  // --- Aksi massal ---
  // Pilihan hanya berlaku untuk baris yang sedang tampil, jadi pelamar yang
  // tersembunyi oleh filter/pencarian tidak ikut diubah tanpa terlihat.
  const selectedApps = useMemo(() => filtered.filter((a) => selectedIds.has(a.id)), [filtered, selectedIds]);
  const hiddenSelectedCount = selectedIds.size - selectedApps.length;
  const allVisibleSelected = filtered.length > 0 && selectedApps.length === filtered.length;

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((a) => next.delete(a.id));
      else filtered.forEach((a) => next.add(a.id));
      return next;
    });
  };

  // Tiga handler di bawah mengerjakan SATU pelamar dan mengembalikan { error? }.
  // Alurnya sama dengan aksi satuan (status, tag, dan pesan lewat route server),
  // sehingga hak akses, riwayat, dan pencatatan log sama persis.
  const bulkChangeStatus = async (app, newStatus, reason) => {
    const res = await requestStatusChange(app, newStatus, reason);
    if (res.error) return { error: res.error };
    return res.skipped ? { skipped: true } : {};
  };

  const bulkAddTag = async (app, tags) => {
    const res = await fetch(`/api/applications/${app.id}/tags`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ add: tags }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || 'Gagal menyimpan tag.' };
    setTagsById((prev) => ({ ...prev, [app.id]: normalizeTags(json.tags) }));
    return {};
  };

  const bulkSendRejection = async (app) => {
    const res = await fetch(`/api/applications/${app.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: 'ditolak', channel: 'email' }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error || 'Gagal mengirim email.' };
    return {};
  };

  const handleExportCsv = () => {
    const header = ['Nama', 'Email', 'Telepon', 'Posisi', 'Tanggal Apply', 'Status', 'Tag', 'Catatan', 'Link CV'];
    const rows = filtered.map((a) => [
      a.nama,
      a.email,
      a.telepon || '',
      a.job_listings?.title || 'CV Umum',
      new Date(a.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
      a.status,
      (tagsById[a.id] || []).join('; '),
      notesForCsv(a),
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
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">
            {scoped ? 'Pelamar Saya' : 'Semua Pelamar'}
          </h1>
          <p className="text-sm text-[#6B6B6B] mt-1">
            {applications.length} total pelamar
            {(filterJob || filterStatus || activeTag || searchTerms.length > 0) && ` · ${filtered.length} ditampilkan`}
          </p>
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

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[240px] max-w-[360px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9A9A9A] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={scoped ? 'Cari nama, email, atau telepon...' : 'Cari nama, email, telepon, posisi diminati, atau tag...'}
            className="w-full border border-[#E0E0E0] pl-9 pr-8 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Hapus pencarian"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9A9A9A] hover:text-black"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <select value={filterJob} onChange={(e) => setFilterJob(e.target.value)} className={selectClass}>
          <option value="">Semua Posisi</option>
          {!scoped && <option value="umum">Umum (tanpa posisi spesifik)</option>}
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

        {tagOptions.length > 0 && (
          <select value={activeTag} onChange={(e) => setFilterTag(e.target.value)} className={selectClass}>
            <option value="">Semua Tag</option>
            {tagOptions.map(({ tag, count }) => (
              <option key={tag} value={tag}>{tag} ({count})</option>
            ))}
          </select>
        )}

        <label className="flex items-center gap-2 text-xs text-[#3D3D3D] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={searchInAnswers}
            onChange={(e) => setSearchInAnswers(e.target.checked)}
            className="accent-[#B91C1C]"
          />
          Cari juga di jawaban screening
        </label>
      </div>

      {historyWarning && (
        <p className="mb-4 text-xs text-[#92700C] bg-[#FEF3C7] px-3 py-2">{historyWarning}</p>
      )}

      {tagsLoadError && (
        <p className="mb-4 text-xs text-[#92700C] bg-[#FEF3C7] px-3 py-2">
          Tag talent pool belum bisa dimuat: {tagsLoadError}. Pastikan migrasi SQL scripts/sql/talent_pool_tags.sql sudah dijalankan.
        </p>
      )}

      {/* Saran tag untuk input di baris pelamar (satu datalist dipakai semua baris) */}
      <datalist id="talent-pool-tags">
        {tagOptions.map(({ tag }) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>

      <BulkApplicantActions
        selectedApps={selectedApps}
        hiddenCount={hiddenSelectedCount}
        canTag={!scoped && !tagsLoadError}
        onChangeStatus={bulkChangeStatus}
        onAddTag={bulkAddTag}
        onSendRejection={bulkSendRejection}
        onFinish={(failedIds) => setSelectedIds(new Set(failedIds))}
        onClear={() => setSelectedIds(new Set())}
      />

      <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
        {loading ? (
          <p className="text-sm text-[#6B6B6B] p-6">Memuat data...</p>
        ) : error ? (
          <p className="text-sm text-madael-red p-6">Gagal memuat data: {error}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-[#6B6B6B] p-6">{searchTerms.length > 0 ? `Tidak ada pelamar yang cocok dengan pencarian "${searchQuery.trim()}".` : 'Tidak ada pelamar yang cocok dengan filter.'}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B] tracking-[0.04em]">
                <th className="pl-5 pr-0 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => { if (el) el.indeterminate = selectedApps.length > 0 && !allVisibleSelected; }}
                    onChange={toggleAllVisible}
                    aria-label="Pilih semua pelamar yang ditampilkan"
                    className="accent-[#B91C1C] cursor-pointer"
                  />
                </th>
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
                const duplicates = duplicateMap.get(a.id);
                const isDupOpen = dupExpandedId === a.id;
                const notes = getNotes(a);
                const noteCount = notes.length + (a.catatan ? 1 : 0);
                return (
                  <Fragment key={a.id}>
                    <tr className={`border-b border-[#F0F0F0] last:border-0 align-top ${selectedIds.has(a.id) ? 'bg-[#FFF9F9]' : ''}`}>
                      <td className="pl-5 pr-0 py-3.5">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(a.id)}
                          onChange={() => toggleSelected(a.id)}
                          aria-label={`Pilih ${a.nama}`}
                          className="accent-[#B91C1C] cursor-pointer"
                        />
                      </td>
                      <td className="px-5 py-3.5 text-black">
                        {highlightText(a.nama, searchTerms)}
                        {duplicates && (
                          <DuplicateBadge
                            count={duplicates.length}
                            open={isDupOpen}
                            onToggle={() => setDupExpandedId(isDupOpen ? null : a.id)}
                          />
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[#3D3D3D]">
                        {a.job_listings?.title || 'CV Umum'}
                        {!a.job_id && a.catatan && (
                          <p className="text-xs text-[#6B6B6B] mt-0.5 line-clamp-2 whitespace-pre-wrap">
                            Minat: {highlightText(a.catatan, searchTerms)}
                          </p>
                        )}
                        {!a.job_id && !scoped && !tagsLoadError && (
                          <TagEditor
                            tags={tagsById[a.id] || []}
                            activeTag={activeTag}
                            searchTerms={searchTerms}
                            busy={tagBusyId === a.id}
                            onFilter={setFilterTag}
                            onAdd={(raw) => handleAddTag(a.id, raw)}
                            onRemove={(tag) => handleRemoveTag(a.id, tag)}
                          />
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-[#6B6B6B]">
                        {new Date(a.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-5 py-3.5 text-[#6B6B6B]">
                        <div>{highlightText(a.email, searchTerms)}</div>
                        {a.telepon && <div className="text-xs">{highlightText(a.telepon, searchTerms)}</div>}
                      </td>
                      <td className="px-5 py-3.5">
                        {a.cv_drive_id ? <CvLink onOpen={() => setCvApp(a)} /> : <span className="text-xs text-[#AAA]">—</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        {hasAnswers ? (
                          <div className="flex flex-col items-start gap-1">
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : a.id)}
                              className="text-xs font-medium text-madael-red hover:text-madael-dark"
                            >
                              {isExpanded ? 'Tutup' : `Lihat (${a.answers.length})`}
                            </button>
                            {answerOnlyIds.has(a.id) && (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 bg-[#FEF3C7] text-[#92700C]">
                                Cocok di jawaban
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-[#AAA]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 min-w-[200px]">
                        {notes[0] ? (
                          <div className="text-xs mb-1.5">
                            <p className="text-black line-clamp-2 whitespace-pre-wrap">{notes[0].isi}</p>
                            <p className="text-[#9A9A9A] mt-0.5">{notes[0].author_nama} · {formatWaktu(notes[0].created_at)}</p>
                          </div>
                        ) : a.catatan ? (
                          <p className="text-xs text-black line-clamp-2 whitespace-pre-wrap mb-1.5">{a.catatan}</p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => openNotes(a.id)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-madael-red hover:text-madael-dark"
                        >
                          <MessageSquare size={13} />
                          {noteCount > 0 ? `Catatan (${noteCount})` : 'Tambah catatan'}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col items-start gap-2">
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
                          <button
                            type="button"
                            onClick={() => openMessages(a)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-madael-red hover:text-madael-dark"
                          >
                            <Send size={12} /> Pesan
                          </button>
                          <button
                            type="button"
                            onClick={() => openHistory(a)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-madael-red hover:text-madael-dark"
                          >
                            <Clock size={12} /> Riwayat
                          </button>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 min-w-[160px]">
                        {a.interview_at ? (
                          <div className="text-xs text-[#3D3D3D]">
                            <div className="font-medium text-black">
                              {new Date(a.interview_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                            </div>
                            <div>{a.interviewer?.nama || '—'}</div>
                            <InterviewVenue app={a} />
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

                    {duplicates && (
                      <tr>
                        <td colSpan={10} className={`p-0 ${isDupOpen ? 'border-b border-[#F0F0F0]' : ''}`}>
                          <div
                            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                              isDupOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                            }`}
                          >
                            <div className="overflow-hidden bg-[#FFFBEB]">
                              <DuplicatePanel duplicates={duplicates} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}

                    {hasAnswers && (
                      <tr>
                        <td colSpan={10} className="p-0 border-b border-[#F0F0F0] last:border-0">
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
                                    <p className="text-black mt-0.5">{qa.answer ? highlightText(qa.answer, searchInAnswers ? searchTerms : []) : '—'}</p>
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

      {cvApp && (
        <CvPreviewModal
          applicationId={cvApp.id}
          title={cvApp.nama}
          subtitle={cvApp.job_listings?.title || 'CV Umum'}
          onClose={() => setCvApp(null)}
        />
      )}

      {rejectApp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6" onClick={closeRejectModal}>
          <div className="bg-white w-full max-w-[440px] p-6 relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={closeRejectModal} disabled={rejectSaving} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black disabled:opacity-40">
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-1">Tolak Pelamar</h2>
            <p className="text-xs text-[#6B6B6B] mb-4">{rejectApp.nama} — {rejectApp.job_listings?.title || 'CV Umum'}</p>

            <p className="text-xs text-[#6B6B6B] mb-1.5">Alasan penolakan</p>
            <select
              value={rejectPreset}
              disabled={rejectSaving}
              onChange={(e) => setRejectPreset(e.target.value)}
              className="w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors mb-3"
            >
              <option value="">Pilih alasan...</option>
              {REJECTION_REASON_PRESETS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <textarea
              value={rejectDetail}
              disabled={rejectSaving}
              onChange={(e) => setRejectDetail(e.target.value)}
              rows={3}
              maxLength={200}
              placeholder={rejectPreset === REJECTION_REASON_OTHER ? 'Jelaskan alasannya (wajib)' : 'Keterangan tambahan (opsional)'}
              className="w-full border border-[#E0E0E0] px-3 py-2 text-xs text-black bg-white focus:outline-none focus:border-madael-red transition-colors resize-y mb-2"
            />
            <p className="text-[11px] text-[#9A9A9A] mb-3">
              Alasan tersimpan di riwayat status pelamar dan hanya terlihat oleh tim rekrutmen. Tidak dikirim ke pelamar.
            </p>

            {rejectError && <p className="text-xs text-red-600 mb-2">{rejectError}</p>}
            <button
              onClick={handleConfirmReject}
              disabled={rejectSaving}
              className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {rejectSaving ? 'Menyimpan...' : 'Tolak Pelamar'}
            </button>
          </div>
        </div>
      )}

      {historyApp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6" onClick={closeHistory}>
          <div className="bg-white w-full max-w-[480px] p-6 relative max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <button onClick={closeHistory} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black">
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-1">Riwayat Status</h2>
            <p className="text-xs text-[#6B6B6B] mb-4">{historyApp.nama} — {historyApp.job_listings?.title || 'CV Umum'}</p>

            <div className="flex-1 overflow-y-auto space-y-3 min-h-[60px]">
              {historyLoading && <p className="text-xs text-[#9A9A9A]">Memuat riwayat...</p>}
              {historyError && <p className="text-xs text-red-600">{historyError}</p>}
              {!historyLoading && !historyError && historyList.length === 0 && (
                <p className="text-xs text-[#9A9A9A]">Belum ada perubahan status yang tercatat.</p>
              )}
              {historyList.map((h) => (
                <div key={h.id} className="border border-[#F0F0F0] bg-[#FAFAFA] px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium">
                    {h.from_status && (
                      <>
                        <span className={`px-1.5 py-0.5 ${STATUS_STYLES[h.from_status] || 'bg-[#F4F4F4] text-[#3D3D3D]'}`}>{h.from_status}</span>
                        <span className="text-[#9A9A9A]">→</span>
                      </>
                    )}
                    <span className={`px-1.5 py-0.5 ${STATUS_STYLES[h.to_status] || 'bg-[#F4F4F4] text-[#3D3D3D]'}`}>{h.to_status}</span>
                  </div>
                  {h.reason && (
                    <p className="text-xs text-black whitespace-pre-wrap mt-1.5">Alasan: {h.reason}</p>
                  )}
                  <p className="text-[11px] text-[#9A9A9A] mt-1">{h.changed_by_nama || 'Tidak diketahui'} · {formatWaktu(h.created_at)}</p>
                </div>
              ))}
              {!historyLoading && !historyError && (
                <div className="border border-dashed border-[#E0E0E0] px-3 py-2.5">
                  <p className="text-xs text-black">Lamaran masuk</p>
                  <p className="text-[11px] text-[#9A9A9A] mt-1">{formatWaktu(historyApp.created_at)}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {notesApp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6" onClick={closeNotes}>
          <div
            className="bg-white w-full max-w-[480px] p-6 relative max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={closeNotes} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black">
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-1">Catatan Pelamar</h2>
            <p className="text-xs text-[#6B6B6B] mb-4">
              {notesApp.nama} — {notesApp.job_listings?.title || 'CV Umum'}
            </p>

            <div className="flex-1 overflow-y-auto space-y-3 mb-4 min-h-[60px]">
              {notesList.length === 0 && !notesApp.catatan && (
                <p className="text-xs text-[#9A9A9A]">Belum ada catatan.</p>
              )}
              {notesList.map((n) => (
                <div key={n.id} className="border border-[#F0F0F0] bg-[#FAFAFA] px-3 py-2.5">
                  <p className="text-xs text-black whitespace-pre-wrap">{n.isi}</p>
                  <p className="text-[11px] text-[#9A9A9A] mt-1">{n.author_nama} · {formatWaktu(n.created_at)}</p>
                </div>
              ))}
              {notesApp.catatan && (
                <div className="border border-dashed border-[#E0E0E0] px-3 py-2.5">
                  <p className="text-xs text-black whitespace-pre-wrap">{notesApp.catatan}</p>
                  <p className="text-[11px] text-[#9A9A9A] mt-1">Catatan awal (sebelum fitur multi-entry)</p>
                </div>
              )}
            </div>

            {noteError && <p className="text-xs text-red-600 mb-2">{noteError}</p>}
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Tulis catatan baru..."
              className="w-full border border-[#E0E0E0] px-3 py-2 text-xs text-black bg-white focus:outline-none focus:border-madael-red transition-colors resize-y mb-3"
            />
            <button
              onClick={handleAddNote}
              disabled={noteSaving || !noteDraft.trim()}
              className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {noteSaving ? 'Menyimpan...' : 'Tambah Catatan'}
            </button>
          </div>
        </div>
      )}

      {msgApp && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6" onClick={closeMessages}>
          <div
            className="bg-white w-full max-w-[520px] p-6 relative max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={closeMessages} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black">
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-1">Pesan ke Kandidat</h2>
            <p className="text-xs text-[#6B6B6B] mb-4">{msgApp.nama} — {msgPosisi || 'CV Umum'}</p>

            <p className="text-xs text-[#6B6B6B] mb-1.5">Template</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {MESSAGE_TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => { setMsgTemplate(t.key); setMsgError(null); setMsgNotice(null); }}
                  className={`px-3 py-1.5 text-xs font-medium border transition-colors ${
                    msgTemplate === t.key
                      ? 'border-madael-red bg-madael-red text-white'
                      : 'border-[#E0E0E0] text-[#3D3D3D] hover:border-madael-red'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex border-b border-[#E0E0E0] mb-4">
              {['email', 'whatsapp'].map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => { setMsgChannel(ch); setMsgError(null); setMsgNotice(null); }}
                  className={`px-4 py-2 text-xs font-medium -mb-px border-b-2 transition-colors ${
                    msgChannel === ch ? 'border-madael-red text-black' : 'border-transparent text-[#9A9A9A] hover:text-black'
                  }`}
                >
                  {CHANNEL_LABEL[ch]}
                </button>
              ))}
            </div>

            {msgStatusMismatch && (
              <p className="text-xs text-[#92700C] bg-[#FEF3C7] px-3 py-2 mb-3">
                Status pelamar saat ini &quot;{msgApp.status}&quot;, template ini biasanya untuk &quot;{TEMPLATE_STATUS[msgTemplate]}&quot;.
              </p>
            )}
            {msgNeedsSchedule && (
              <p className="text-xs text-[#B91C1C] bg-[#FEE2E2] px-3 py-2 mb-3">
                Belum ada jadwal interview. Tutup jendela ini lalu klik &quot;Jadwalkan&quot; dulu supaya jadwal masuk ke pesan.
              </p>
            )}
            {msgNeedsVenue && (
              <p className="text-xs text-[#B91C1C] bg-[#FEE2E2] px-3 py-2 mb-3">
                Lokasi atau link meeting interview belum diisi. Tutup jendela ini lalu klik &quot;Ubah jadwal&quot; untuk melengkapinya.
              </p>
            )}

            {msgChannel === 'email' ? (
              <div className="mb-4">
                <p className="text-xs text-[#6B6B6B] mb-1">Kepada</p>
                <p className="text-sm text-black mb-2">{msgApp.email}</p>
                <p className="text-xs text-[#6B6B6B]">
                  Email dikirim langsung oleh sistem begitu Anda klik kirim (dwibahasa Indonesia/English). Mengubah
                  status pelamar tidak mengirim email.
                </p>
              </div>
            ) : (
              <div className="mb-4">
                <p className="text-xs text-[#6B6B6B] mb-1">Nomor WhatsApp</p>
                {msgWaPhone ? (
                  <p className="text-sm text-black mb-2">+{msgWaPhone}</p>
                ) : (
                  <p className="text-xs text-[#B91C1C] mb-2">
                    {msgApp.telepon
                      ? `Nomor pelamar "${msgApp.telepon}" bukan nomor WhatsApp yang valid.`
                      : 'Pelamar tidak mengisi nomor telepon.'}
                  </p>
                )}
                <p className="text-xs text-[#6B6B6B] mb-1">Pratinjau pesan</p>
                <pre className="text-xs text-black bg-[#FAFAFA] border border-[#F0F0F0] px-3 py-2.5 whitespace-pre-wrap font-sans">
                  {msgWaText}
                </pre>
              </div>
            )}

            {msgError && <p className="text-xs text-red-600 mb-3">{msgError}</p>}
            {msgNotice && <p className="text-xs text-[#166534] mb-3">{msgNotice}</p>}

            {msgChannel === 'email' ? (
              <button
                onClick={handleSendEmail}
                disabled={msgSending || msgBlocked}
                className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
              >
                {msgSending ? 'Mengirim...' : 'Kirim Email Sekarang'}
              </button>
            ) : msgWaUrl ? (
              <a
                href={msgWaUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleWhatsAppClick}
                className="block text-center w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
              >
                Buka WhatsApp
              </a>
            ) : (
              <span className="block text-center w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] opacity-50 cursor-not-allowed">
                Buka WhatsApp
              </span>
            )}

            <h3 className="text-xs font-medium text-black mt-6 mb-2">Riwayat Pesan</h3>
            {msgHistoryLoading ? (
              <p className="text-xs text-[#9A9A9A]">Memuat riwayat...</p>
            ) : msgHistoryError ? (
              <p className="text-xs text-red-600">{msgHistoryError}</p>
            ) : msgHistory.length === 0 ? (
              <p className="text-xs text-[#9A9A9A]">Belum ada pesan yang tercatat.</p>
            ) : (
              <div className="space-y-2.5">
                {msgHistory.map((m) => (
                  <div key={m.id} className="border border-[#F0F0F0] bg-[#FAFAFA] px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-medium text-black">
                        {CHANNEL_LABEL[m.channel] || m.channel} · {getTemplateLabel(m.template)}
                      </span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 shrink-0 ${MSG_STATUS_STYLE[m.status] || 'bg-[#F4F4F4] text-[#3D3D3D]'}`}>
                        {MSG_STATUS_LABEL[m.status] || m.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#9A9A9A] mt-1">
                      {formatWaktu(m.created_at)} ·{' '}
                      {m.source === 'otomatis'
                        ? `Otomatis saat status diubah${m.sent_by_nama ? ` (${m.sent_by_nama})` : ''}`
                        : m.sent_by_nama || '—'}
                      {m.recipient ? ` · ke ${m.channel === 'whatsapp' ? '+' : ''}${m.recipient}` : ''}
                    </p>
                    {m.error && <p className="text-[11px] text-red-600 mt-1">{m.error}</p>}
                    {m.status !== 'gagal' && (
                      <details className="mt-1.5">
                        <summary className="text-[11px] text-madael-red cursor-pointer">Lihat isi pesan</summary>
                        <pre className="text-xs text-black whitespace-pre-wrap font-sans mt-1.5">{m.body}</pre>
                      </details>
                    )}
                    {m.status === 'wa_dibuka' && (
                      <button
                        type="button"
                        onClick={() => handleConfirmWhatsApp(m.id)}
                        className="mt-2 text-[11px] font-medium text-madael-red hover:text-madael-dark"
                      >
                        Sudah saya kirim di WhatsApp
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
                {schedulingInterviewers.map((i) => (
                  <option key={i.id} value={i.id}>{i.nama}</option>
                ))}
              </select>
              {schedulingInterviewers.length === 0 && (
                <span className="text-[11px] text-[#9A9A9A]">Belum ada karyawan dengan akses modul Job Portal.</span>
              )}
            </label>

            <div className="mb-3">
              <span className="text-xs text-[#6B6B6B] block mb-1.5">Format Interview</span>
              <div className="flex flex-wrap gap-2">
                {INTERVIEW_MODES.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setScheduleForm((f) => ({ ...f, interview_mode: m.key }))}
                    className={`px-3 py-1.5 text-xs font-medium border transition-colors ${
                      scheduleForm.interview_mode === m.key
                        ? 'border-madael-red bg-madael-red text-white'
                        : 'border-[#E0E0E0] text-[#3D3D3D] hover:border-madael-red'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {scheduleForm.interview_mode === 'online' ? (
              <label className="flex flex-col gap-1 mb-5">
                <span className="text-xs text-[#6B6B6B]">Link Meeting (Zoom / Google Meet / Teams)</span>
                <input
                  type="url"
                  value={scheduleForm.interview_meeting_url}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, interview_meeting_url: e.target.value }))}
                  placeholder="https://zoom.us/j/..."
                  className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
                />
                <span className="text-[11px] text-[#9A9A9A]">Link ini ikut terkirim di email dan WhatsApp ke kandidat.</span>
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1 mb-3">
                  <span className="text-xs text-[#6B6B6B]">Nama Lokasi (opsional)</span>
                  <input
                    value={scheduleForm.interview_location}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, interview_location: e.target.value }))}
                    placeholder="Kantor Pusat"
                    className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
                  />
                </label>
                <label className="flex flex-col gap-1 mb-5">
                  <span className="text-xs text-[#6B6B6B]">Alamat Lengkap</span>
                  <textarea
                    rows={3}
                    value={scheduleForm.interview_address}
                    onChange={(e) => setScheduleForm((f) => ({ ...f, interview_address: e.target.value }))}
                    placeholder="Gedung, jalan, kota, kode pos. Tambahkan lantai/patokan bila perlu."
                    className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors resize-none"
                  />
                </label>
              </>
            )}

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