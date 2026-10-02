import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireJobPortalAccess } from '@/lib/jobPortalServer';
import { JOB_PORTAL_ASSIGNED_KEY } from '@/lib/jobPortalAccess';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployees } from '@/lib/notify';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REVIEWERS = 50;

// Hanya akses penuh (superadmin / pemegang job_portal) yang boleh melihat dan
// mengubah daftar reviewer. Reviewer terbatas tidak boleh meng-assign siapa pun.
async function requireFullAccess(admin) {
  const access = await requireJobPortalAccess(admin);
  if (access.error) return access;
  if (access.scope.level !== 'full') {
    return { error: 'Hanya pengelola Job Portal yang boleh mengatur reviewer lowongan.', status: 403 };
  }
  return access;
}

async function loadJob(admin, id) {
  if (!UUID_RE.test(id)) return null;
  const { data, error } = await admin
    .from('job_listings')
    .select('id, title, slug')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Karyawan aktif pemegang modul job_portal_assigned = kandidat reviewer.
async function loadCandidates(admin) {
  const { data, error } = await admin
    .from('employee_modules')
    .select('employee_id, employees:employee_id ( id, nama, status )')
    .eq('module_name', JOB_PORTAL_ASSIGNED_KEY);
  if (error) throw error;

  const byId = new Map();
  (data || []).forEach((row) => {
    const e = row.employees;
    if (e && e.status === 'Aktif') byId.set(e.id, e.nama);
  });
  return Array.from(byId, ([id, nama]) => ({ id, nama })).sort((a, b) => a.nama.localeCompare(b.nama));
}

async function loadReviewers(admin, jobId) {
  const { data, error } = await admin
    .from('job_listing_reviewers')
    .select('employee_id, employees:employee_id ( id, nama )')
    .eq('job_id', jobId);
  if (error) throw error;
  return (data || [])
    .map((r) => ({ id: r.employee_id, nama: r.employees?.nama || '(tanpa nama)' }))
    .sort((a, b) => a.nama.localeCompare(b.nama));
}

// GET /api/job-listings/[id]/reviewers
// -> { reviewers: [{id, nama}], candidates: [{id, nama}] }
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    const access = await requireFullAccess(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

    const job = await loadJob(admin, id);
    if (!job) return NextResponse.json({ error: 'Lowongan tidak ditemukan.' }, { status: 404 });

    const [reviewers, candidates] = await Promise.all([loadReviewers(admin, id), loadCandidates(admin)]);
    return NextResponse.json({ reviewers, candidates });
  } catch (err) {
    console.error('Reviewers GET error:', err);
    return NextResponse.json(
      { error: 'Reviewer belum bisa dimuat. Pastikan migrasi SQL job_listing_reviewers sudah dijalankan.' },
      { status: 500 }
    );
  }
}

// PUT /api/job-listings/[id]/reviewers   body: { employeeIds: string[] }
// Mengganti seluruh daftar reviewer lowongan dengan daftar yang dikirim.
// Hanya karyawan aktif pemegang modul job_portal_assigned yang diterima.
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    const access = await requireFullAccess(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    const { emp } = access;

    const job = await loadJob(admin, id);
    if (!job) return NextResponse.json({ error: 'Lowongan tidak ditemukan.' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const raw = body.employeeIds;
    if (!Array.isArray(raw) || raw.length > MAX_REVIEWERS || !raw.every((v) => typeof v === 'string' && UUID_RE.test(v))) {
      return NextResponse.json({ error: 'Daftar reviewer tidak valid.' }, { status: 400 });
    }
    const wanted = Array.from(new Set(raw));

    const candidates = await loadCandidates(admin);
    const candidateName = new Map(candidates.map((c) => [c.id, c.nama]));
    const invalid = wanted.filter((eid) => !candidateName.has(eid));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: 'Ada akun yang bukan karyawan aktif dengan akses "Job Portal Terbatas".' },
        { status: 422 }
      );
    }

    const current = await loadReviewers(admin, id);
    const currentIds = new Set(current.map((r) => r.id));
    const wantedIds = new Set(wanted);

    const toAdd = wanted.filter((eid) => !currentIds.has(eid));
    const toRemove = current.filter((r) => !wantedIds.has(r.id));

    if (toRemove.length > 0) {
      const { error } = await admin
        .from('job_listing_reviewers')
        .delete()
        .eq('job_id', id)
        .in('employee_id', toRemove.map((r) => r.id));
      if (error) throw error;
    }

    if (toAdd.length > 0) {
      const { error } = await admin
        .from('job_listing_reviewers')
        .insert(toAdd.map((eid) => ({ job_id: id, employee_id: eid, assigned_by: emp.id })));
      if (error) throw error;
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      await logActivity(admin, {
        userId: emp.id,
        aksi: 'atur_reviewer_lowongan',
        targetTable: 'job_listings',
        targetId: id,
        detail: {
          lowongan: job.title,
          ditambahkan: toAdd.map((eid) => candidateName.get(eid)),
          dihapus: toRemove.map((r) => r.nama),
        },
      });

      await notifyEmployees(admin, {
        userIds: toAdd,
        tipe: 'reviewer_ditugaskan',
        pesan: `Kamu ditugaskan sebagai reviewer untuk lowongan ${job.title}.`,
        link: `/employee/job-portal/pelamar?posisi=${job.slug}`,
      });
    }

    const reviewers = wanted
      .map((eid) => ({ id: eid, nama: candidateName.get(eid) }))
      .sort((a, b) => a.nama.localeCompare(b.nama));
    return NextResponse.json({ success: true, reviewers });
  } catch (err) {
    console.error('Reviewers PUT error:', err);
    return NextResponse.json({ error: 'Gagal menyimpan reviewer. Coba lagi.' }, { status: 500 });
  }
}
