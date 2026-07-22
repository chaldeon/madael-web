import {
  Users, Briefcase, BarChart3, Calculator, Clock,
  Receipt, CalendarDays, Wallet, FileText, ShieldCheck, Handshake, PieChart,
} from 'lucide-react';

// Single source of truth untuk semua modul employee area.
// status: 'live' (sudah bisa dipakai) | 'in_progress' (sedang dibangun, ada branch) | 'coming_soon' (belum mulai)
// branch/previewUrl opsional, diisi saat modul in_progress punya branch/preview Vercel.
// altKeys: permission granular sub-menu yang juga membuka card ini di dashboard
// (mis. seseorang yang cuma di-grant 'payslip_admin' tanpa 'payslip' tetap
// bisa masuk lewat card Payslip, karena sub-menu Kelola Payslip ada di dalamnya).
// Dipakai oleh app/employee/dashboard (grid modul karyawan) dan app/employee/dev-modules (roadmap superadmin).
export const MODULE_REGISTRY = [
  { key: 'employee_list', name: 'Employee List', desc: 'Kelola data dan akses karyawan', href: '/employee/list', status: 'live', icon: Users },
  { key: 'job_portal', name: 'Job Portal', desc: 'Kelola lowongan dan kandidat', href: '/employee/job-portal', status: 'live', icon: Briefcase },
  { key: 'crm', name: 'CRM', desc: 'Pipeline klien dan BD Madael', href: '/employee/crm', status: 'live', icon: Handshake },
  { key: 'statistics', name: 'Statistics', desc: 'Laporan dan statistik perusahaan', href: '/employee/statistics', status: 'live', icon: BarChart3 },
  { key: 'kalkulator', name: 'Kalkulator', desc: 'PPh 21, BPJS, dan kalkulator lainnya', href: '/kalkulator-pph21', status: 'live', icon: Calculator },
  { key: 'absensi', name: 'Absensi', desc: 'Clock in/out, GPS, jadwal kerja, dan flag keterlambatan', href: '/employee/absensi', status: 'live', icon: Clock, altKeys: ['absensi_jadwal'] },
  { key: 'payslip', name: 'Payslip', desc: 'Slip gaji karyawan', href: '/employee/payslip', status: 'live', icon: Receipt, altKeys: ['payslip_admin'] },
  { key: 'leave_request', name: 'Leave Request', desc: 'Pengajuan cuti karyawan', href: '/employee/leave-request', status: 'live', icon: CalendarDays },
  { key: 'payroll', name: 'Payroll', desc: 'Employee master data dan struktur gaji', href: '/employee/payroll', status: 'live', icon: Wallet },
  { key: 'document_generator', name: 'Documents', desc: 'Generate proposal, quotation, agreement, dan nomor surat', href: '/employee/documents', status: 'live', icon: FileText, altKeys: ['nomor_surat'] },
  { key: 'compliance_monitor', name: 'Compliance Monitor', desc: 'Pantau kepatuhan hukum', href: '/employee/compliance-monitor', status: 'coming_soon', icon: ShieldCheck },
  { key: 'reports', name: 'Reports', desc: 'Ringkasan data lintas modul (khusus superadmin)', href: '/employee/reports', status: 'live', icon: PieChart },
];

// Daftar module key yang bisa di-assign superadmin ke employee (checkbox di
// app/employee/list). Key granular (payslip_admin, nomor_surat, absensi_jadwal,
// document_manage) mengontrol akses ke sub-menu/aksi spesifik di dalam modul
// induknya — independen dari akses ke modul induk itu sendiri.
export const MODULE_OPTIONS = [
  { key: 'employee_list', label: 'Employee List' },
  { key: 'job_portal', label: 'Job Portal' },
  { key: 'crm', label: 'CRM' },
  { key: 'statistics', label: 'Statistics' },
  { key: 'kalkulator', label: 'Kalkulator' },
  { key: 'absensi', label: 'Absensi' },
  { key: 'absensi_jadwal', label: '— Sub: Kelola Jadwal Kerja' },
  { key: 'payslip', label: 'Payslip' },
  { key: 'payslip_admin', label: '— Sub: Kelola Payslip' },
  { key: 'leave_request', label: 'Leave Request' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'document_generator', label: 'Document Generator' },
  { key: 'nomor_surat', label: '— Sub: Kelola Nomor Surat' },
  { key: 'document_manage', label: '— Sub: Edit/Hapus Dokumen Siapa Saja' },
  { key: 'compliance_monitor', label: 'Compliance Monitor' },
];

// Modul yang otomatis di-grant ke employee baru (non-superadmin) saat dibuat
// lewat /api/employee/create. Superadmin tidak perlu ini karena sudah
// otomatis punya akses ke semua modul.
export const DEFAULT_MODULE_ACCESS = ['kalkulator', 'absensi', 'payslip', 'leave_request'];