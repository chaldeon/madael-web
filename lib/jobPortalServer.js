import { getSessionEmployee } from '@/lib/sessionEmployee';
import { JOB_PORTAL_KEYS, getJobPortalLevel } from '@/lib/jobPortalAccess';

// SERVER ONLY — pengecekan akses Job Portal untuk API route yang memakai
// service role (RLS tidak berlaku di sana, jadi scope per lowongan HARUS
// ditegakkan manual di sini).

// Login + akun aktif + punya akses Job Portal (full ATAU terbatas).
// Return { emp, scope } kalau lolos, atau { error, status } untuk dikirim
// sebagai JSON.
//   scope.level  : 'full' | 'assigned'
//   scope.jobIds : Set id lowongan yang di-assign (hanya untuk 'assigned')
export async function requireJobPortalAccess(admin) {
  const session = await getSessionEmployee('id, nama, status, is_superadmin');
  if (session.error) return { error: session.error, status: session.status };
  const { emp } = session;

  const { data: mods, error } = await admin
    .from('employee_modules')
    .select('module_name')
    .eq('employee_id', emp.id)
    .in('module_name', JOB_PORTAL_KEYS);
  if (error) throw error;

  const level = getJobPortalLevel({
    isSuperadmin: emp.is_superadmin,
    moduleKeys: (mods || []).map((m) => m.module_name),
  });
  if (level === 'none') {
    return { error: 'Anda tidak punya akses ke modul Job Portal.', status: 403 };
  }

  if (level === 'full') return { emp, scope: { level, jobIds: null } };

  const { data: rows, error: reviewerError } = await admin
    .from('job_listing_reviewers')
    .select('job_id')
    .eq('employee_id', emp.id);
  if (reviewerError) throw reviewerError;

  return { emp, scope: { level, jobIds: new Set((rows || []).map((r) => r.job_id)) } };
}

// Boleh menyentuh lowongan/lamaran ber-job_id ini?
// Lamaran umum (job_id null) hanya untuk akses penuh.
export function canAccessJob(scope, jobId) {
  if (scope.level === 'full') return true;
  return Boolean(jobId) && scope.jobIds.has(jobId);
}

export const OUT_OF_SCOPE_ERROR = 'Anda tidak ditugaskan sebagai reviewer untuk lowongan ini.';

// Untuk route yang hanya menerima application id dan belum membaca lamarannya.
// Return {} kalau boleh, atau { error, status } untuk dikirim sebagai JSON.
export async function checkApplicationScope(admin, scope, applicationId) {
  if (scope.level === 'full') return {};

  const { data, error } = await admin
    .from('applications')
    .select('job_id')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) {
    // 22P02 = id bukan format yang valid untuk kolom id
    if (error.code === '22P02') return { error: 'Lamaran tidak ditemukan.', status: 404 };
    throw error;
  }
  if (!data) return { error: 'Lamaran tidak ditemukan.', status: 404 };
  if (!canAccessJob(scope, data.job_id)) return { error: OUT_OF_SCOPE_ERROR, status: 403 };
  return {};
}
