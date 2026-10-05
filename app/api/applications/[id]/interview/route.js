import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployee } from '@/lib/notify';
import { isHttpUrl } from '@/lib/candidateMessages';
import { getJobPortalLevel, JOB_PORTAL_KEYS } from '@/lib/jobPortalAccess';
import { canAccessJob, OUT_OF_SCOPE_ERROR, requireJobPortalAccess } from '@/lib/jobPortalServer';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LOCATION = 200;
const MAX_ADDRESS = 500;
const MAX_URL = 500;

const INTERVIEW_COLUMNS =
  'id, status, interview_at, interview_interviewer_id, interview_mode, interview_location, interview_address, interview_meeting_url, interviewer:interview_interviewer_id ( nama )';

// Interviewer harus karyawan aktif yang memang boleh menangani lowongan ini:
// akses penuh Job Portal / superadmin, atau reviewer terbatas yang di-assign ke
// lowongan lamaran. Aturan yang sama dengan daftar pilihan di halaman Pelamar,
// tapi ditegakkan di server. Return { id, nama } atau null.
async function findEligibleInterviewer(admin, interviewerId, jobId) {
  const { data: person, error } = await admin
    .from('employees')
    .select('id, nama, status, is_superadmin')
    .eq('id', interviewerId)
    .maybeSingle();
  if (error) throw error;
  if (!person || person.status !== 'Aktif') return null;

  const { data: mods, error: modsError } = await admin
    .from('employee_modules')
    .select('module_name')
    .eq('employee_id', person.id)
    .in('module_name', JOB_PORTAL_KEYS);
  if (modsError) throw modsError;

  const level = getJobPortalLevel({
    isSuperadmin: !!person.is_superadmin,
    moduleKeys: (mods || []).map((m) => m.module_name),
  });
  if (level === 'full') return { id: person.id, nama: person.nama };

  if (level === 'assigned' && jobId) {
    const { data: row, error: reviewerError } = await admin
      .from('job_listing_reviewers')
      .select('employee_id')
      .eq('job_id', jobId)
      .eq('employee_id', person.id)
      .maybeSingle();
    if (reviewerError) throw reviewerError;
    if (row) return { id: person.id, nama: person.nama };
  }
  return null;
}

// PATCH /api/applications/[id]/interview
// body: { interview_at, interviewer_id, mode: 'online'|'offline', location?, address?, meeting_url? }
// Simpan jadwal interview. Hanya untuk pelamar yang berstatus "Interview" (sama
// dengan tombol "Jadwalkan" di UI). Online -> link meeting wajib; offline ->
// alamat lengkap wajib. Interviewer dikabari lewat notifikasi in-app.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    const access = await requireJobPortalAccess(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    const { emp, scope } = access;

    const body = await request.json().catch(() => ({}));
    const text = (v) => (typeof v === 'string' ? v.trim() : '');

    const at = new Date(body.interview_at);
    if (!body.interview_at || Number.isNaN(at.getTime())) {
      return NextResponse.json({ error: 'Tanggal/jam interview tidak valid.' }, { status: 400 });
    }
    const interviewerId = text(body.interviewer_id);
    if (!UUID_RE.test(interviewerId)) {
      return NextResponse.json({ error: 'Interviewer wajib dipilih.' }, { status: 400 });
    }

    const isOnline = body.mode === 'online';
    if (body.mode !== 'online' && body.mode !== 'offline') {
      return NextResponse.json({ error: 'Format interview tidak valid.' }, { status: 400 });
    }
    const meetingUrl = text(body.meeting_url);
    const address = text(body.address);
    const location = text(body.location);
    if (isOnline && (!isHttpUrl(meetingUrl) || meetingUrl.length > MAX_URL)) {
      return NextResponse.json(
        { error: 'Link meeting wajib diisi dan harus diawali http:// atau https://.' },
        { status: 400 }
      );
    }
    if (!isOnline && (!address || address.length > MAX_ADDRESS || location.length > MAX_LOCATION)) {
      return NextResponse.json(
        { error: 'Alamat lengkap wajib diisi untuk interview offline (maks. 500 karakter; lokasi maks. 200).' },
        { status: 400 }
      );
    }

    const { data: app, error: lookupError } = await admin
      .from('applications')
      .select('id, nama, job_id, status, interview_at, interview_interviewer_id, job_listings ( title )')
      .eq('id', id)
      .maybeSingle();
    if (lookupError) {
      // 22P02 = id bukan format yang valid untuk kolom id
      if (lookupError.code === '22P02') {
        return NextResponse.json({ error: 'Lamaran tidak ditemukan.' }, { status: 404 });
      }
      throw lookupError;
    }
    if (!app) return NextResponse.json({ error: 'Lamaran tidak ditemukan.' }, { status: 404 });
    if (!canAccessJob(scope, app.job_id)) {
      return NextResponse.json({ error: OUT_OF_SCOPE_ERROR }, { status: 403 });
    }
    if (app.status !== 'Interview') {
      return NextResponse.json(
        { error: 'Jadwal interview hanya bisa diatur saat status pelamar "Interview".' },
        { status: 409 }
      );
    }

    const interviewer = await findEligibleInterviewer(admin, interviewerId, app.job_id);
    if (!interviewer) {
      return NextResponse.json(
        { error: 'Interviewer tidak valid untuk lowongan ini.' },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await admin
      .from('applications')
      .update({
        interview_at: at.toISOString(),
        interview_interviewer_id: interviewer.id,
        interview_mode: isOnline ? 'online' : 'offline',
        interview_location: isOnline ? null : location || null,
        interview_address: isOnline ? null : address,
        interview_meeting_url: isOnline ? meetingUrl : null,
      })
      .eq('id', id)
      .eq('status', 'Interview')
      .select(INTERVIEW_COLUMNS)
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      return NextResponse.json(
        { error: 'Status pelamar baru saja diubah orang lain. Muat ulang halaman lalu coba lagi.' },
        { status: 409 }
      );
    }

    const posisi = app.job_listings?.title || 'CV Umum';
    await logActivity(admin, {
      userId: emp.id,
      aksi: 'jadwal_interview_pelamar',
      targetTable: 'applications',
      targetId: app.id,
      detail: {
        nama: app.nama,
        posisi,
        interview_at: updated.interview_at,
        interviewer: interviewer.nama,
        mode: updated.interview_mode,
        sebelumnya: app.interview_at
          ? { interview_at: app.interview_at, interviewer_id: app.interview_interviewer_id }
          : null,
      },
    });

    const waktu = at.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
    await notifyEmployee(admin, {
      userId: interviewer.id,
      tipe: 'interview_dijadwalkan',
      pesan: `Kamu dijadwalkan jadi interviewer untuk ${app.nama} (${posisi}) pada ${waktu} WIB.`,
      link: '/employee/job-portal/pelamar',
    });

    return NextResponse.json({ success: true, application: updated });
  } catch (err) {
    console.error('Interview PATCH unexpected error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}
