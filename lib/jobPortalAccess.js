import { isModuleGranted } from '@/lib/employeeModules';

// Akses Job Portal punya dua tingkat:
//   'full'     : superadmin atau pemegang modul `job_portal` — melihat SEMUA
//                lowongan & pelamar, serta boleh mengelola lowongan dan
//                meng-assign reviewer.
//   'assigned' : pemegang modul `job_portal_assigned` (tanpa `job_portal`) —
//                hanya melihat lowongan yang di-assign ke dia lewat tabel
//                job_listing_reviewers, beserta pelamar lowongan itu.
//   'none'     : tidak punya akses.
// Kalau seseorang memegang keduanya, 'full' menang (perilaku lama tidak berubah).
export const JOB_PORTAL_KEY = 'job_portal';
export const JOB_PORTAL_ASSIGNED_KEY = 'job_portal_assigned';
export const JOB_PORTAL_KEYS = [JOB_PORTAL_KEY, JOB_PORTAL_ASSIGNED_KEY];

export function getJobPortalLevel({ isSuperadmin, moduleKeys }) {
  if (isModuleGranted({ isSuperadmin, moduleKeys, key: JOB_PORTAL_KEY })) return 'full';
  if (isModuleGranted({ isSuperadmin, moduleKeys, key: JOB_PORTAL_ASSIGNED_KEY })) return 'assigned';
  return 'none';
}

// Dipakai di client component: true kalau user HANYA boleh lihat lowongan yang
// di-assign. Mengembalikan false selama `employee` belum termuat.
export function isJobPortalScoped(employee, moduleKeys) {
  if (!employee) return false;
  return getJobPortalLevel({ isSuperadmin: !!employee.is_superadmin, moduleKeys }) === 'assigned';
}
