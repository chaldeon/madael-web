import {
  Users, Briefcase, BarChart3, Calculator, Clock,
  Receipt, CalendarDays, Wallet, FileText, ShieldCheck, Handshake,
} from 'lucide-react';

// Single source of truth untuk semua modul employee area.
// status: 'live' (sudah bisa dipakai) | 'in_progress' (sedang dibangun, ada branch) | 'coming_soon' (belum mulai)
// branch/previewUrl opsional, diisi saat modul in_progress punya branch/preview Vercel.
// Dipakai oleh app/employee/dashboard (grid modul karyawan) dan app/employee/dev-modules (roadmap superadmin).
export const MODULE_REGISTRY = [
  { key: 'employee_list', name: 'Employee List', desc: 'Kelola data dan akses karyawan', href: '/employee/list', status: 'live', icon: Users },
  { key: 'job_portal', name: 'Job Portal', desc: 'Kelola lowongan dan kandidat', href: '/employee/job-portal', status: 'live', icon: Briefcase },
  { key: 'crm', name: 'CRM', desc: 'Pipeline klien dan BD Madael', href: '/employee/crm', status: 'live', icon: Handshake },
  { key: 'statistics', name: 'Statistics', desc: 'Laporan dan statistik perusahaan', href: '/employee/statistics', status: 'live', icon: BarChart3 },
  { key: 'kalkulator', name: 'Kalkulator', desc: 'PPh 21, BPJS, dan kalkulator lainnya', href: '/kalkulator-pph21', status: 'live', icon: Calculator },
  { key: 'absensi', name: 'Absensi', desc: 'Clock in/out, GPS, dan flag keterlambatan', href: '/employee/absensi', status: 'live', icon: Clock },
  { key: 'payslip', name: 'Payslip', desc: 'Slip gaji karyawan', href: '/employee/payslip', status: 'live', icon: Receipt },
  { key: 'payslip_admin', name: 'Kelola Payslip', desc: 'Upload dan kelola slip gaji karyawan', href: '/employee/payslip/admin', status: 'live', icon: Wallet, superadminOnly: true },
  { key: 'leave_request', name: 'Leave Request', desc: 'Pengajuan cuti karyawan', href: '/employee/leave-request', status: 'coming_soon', icon: CalendarDays },
  { key: 'payroll', name: 'Payroll', desc: 'Employee master data dan struktur gaji', href: '/employee/payroll', status: 'live', icon: Wallet, superadminOnly: true },
  { key: 'document_generator', name: 'Documents', desc: 'Generate proposal, quotation, dan agreement', href: '/employee/documents', status: 'live', icon: FileText },
  { key: 'document_generator', name: 'Nomor Surat', desc: 'Monitor dan koreksi counter nomor surat', href: '/employee/documents/nomor-surat', status: 'live', icon: FileText, superadminOnly: true },
  { key: 'compliance_monitor', name: 'Compliance Monitor', desc: 'Pantau kepatuhan hukum', href: '/employee/compliance-monitor', status: 'coming_soon', icon: ShieldCheck },
];

export const MODULE_OPTIONS = [
  { key: 'employee_list', label: 'Employee List' },
  { key: 'job_portal', label: 'Job Portal' },
  { key: 'crm', label: 'CRM' },
  { key: 'statistics', label: 'Statistics' },
  { key: 'kalkulator', label: 'Kalkulator' },
  { key: 'absensi', label: 'Absensi' },
  { key: 'payslip', label: 'Payslip' },
  { key: 'leave_request', label: 'Leave Request' },
  { key: 'document_generator', label: 'Document Generator' },
  { key: 'compliance_monitor', label: 'Compliance Monitor' },
];