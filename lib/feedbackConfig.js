// Konfigurasi bersama fitur Feedback / Pusat Bantuan (dipakai client & server).

export const FEEDBACK_JENIS = [
  { key: 'bug', label: 'Bug' },
  { key: 'pertanyaan', label: 'Pertanyaan Cara Pakai' },
  { key: 'saran', label: 'Saran' },
];
export const FEEDBACK_JENIS_LABEL = Object.fromEntries(FEEDBACK_JENIS.map((j) => [j.key, j.label]));

export const FEEDBACK_STATUS_LABEL = { baru: 'Baru', diproses: 'Diproses', selesai: 'Selesai' };

export const FEEDBACK_MAX_TEXT = 4000;
// 4MB, bukan 5MB: batas body request serverless Vercel ~4.5MB.
export const FEEDBACK_MAX_FILE = 4 * 1024 * 1024;
export const FEEDBACK_ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

// Auto-tag modul asal berdasarkan path halaman saat form dibuka.
// Urutan tidak penting selama tidak ada prefix yang saling tumpang tindih.
const MODULE_TAGS = [
  ['/employee/dashboard', 'dashboard', 'Dashboard'],
  ['/employee/profile', 'profile', 'Profil'],
  ['/employee/absensi', 'absensi', 'Absensi'],
  ['/employee/leave-request', 'leave_request', 'Cuti'],
  ['/employee/payslip', 'payslip', 'Payslip'],
  ['/employee/payroll', 'payroll', 'Payroll'],
  ['/employee/reimbursement', 'reimbursement', 'Reimbursement'],
  ['/employee/list', 'employee_list', 'Employee List'],
  ['/employee/announcements', 'announcements', 'Pengumuman'],
  ['/employee/job-portal', 'job_portal', 'Job Portal'],
  ['/employee/crm', 'crm', 'CRM'],
  ['/employee/statistics', 'statistics', 'Statistics'],
  ['/employee/reports', 'reports', 'Reports'],
  ['/employee/documents', 'document_generator', 'Documents'],
  ['/employee/activity-log', 'activity_log', 'Activity Log'],
  ['/employee/data-audit', 'data_audit', 'Kelengkapan Data'],
  ['/employee/support', 'support', 'Pusat Bantuan'],
  ['/kalkulator', 'kalkulator', 'Kalkulator'],
];

// Opsi filter modul di panel admin (urutan sama dengan MODULE_TAGS + fallback).
export const FEEDBACK_MODULES = [
  ...MODULE_TAGS.map(([, key, label]) => ({ key, label })),
  { key: 'lainnya', label: 'Lainnya' },
];

export function resolveModuleTag(pathname) {
  const path = typeof pathname === 'string' ? pathname : '';
  const hit = MODULE_TAGS.find(([prefix]) => path.startsWith(prefix));
  return hit ? { key: hit[1], label: hit[2] } : { key: 'lainnya', label: 'Lainnya' };
}
