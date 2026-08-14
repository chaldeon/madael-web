import {
  Users, Briefcase, BarChart3, Calculator, Clock,
  Receipt, CalendarDays, Wallet, FileText, ShieldCheck, Handshake, PieChart, History,
  ClipboardCheck, CalendarCheck, FileSpreadsheet,
} from 'lucide-react';

// Single source of truth untuk semua modul employee area.
// status: 'live' (sudah bisa dipakai) | 'in_progress' (sedang dibangun, ada branch) | 'coming_soon' (belum mulai)
// branch/previewUrl opsional, diisi saat modul in_progress punya branch/preview Vercel.
// altKeys: permission granular sub-menu yang juga membuka card ini di dashboard
// (mis. seseorang yang cuma di-grant 'payslip_admin' tanpa 'payslip' tetap
// bisa masuk lewat card Payslip, karena sub-menu Kelola Payslip ada di dalamnya).
// layer: dipakai app/employee/dashboard untuk susun 2-layer tampilan karyawan
// non-superadmin — 'personal' (data milik sendiri, sama untuk semua karyawan),
// 'hris' (modul kelola-tim, dikelompokkan jadi satu folder HRIS di dashboard,
// folder ini cuma tampil kalau employee punya akses ke minimal 1 modul hris),
// 'general' (modul kerja lain, di luar folder HRIS). Superadmin tidak
// menggunakan layer ini — dashboard superadmin tetap 1 grid datar semua modul.
// Dipakai oleh app/employee/dashboard (grid modul karyawan) dan app/employee/dev-modules (roadmap superadmin).
export const MODULE_REGISTRY = [
  // --- Layer 1: Dashboard Saya (personal, sama untuk semua karyawan) ---
  { key: 'absensi', name: 'Absensi Saya', desc: 'Clock in/out, GPS, dan ajukan koreksi absensi', href: '/employee/absensi', status: 'live', icon: Clock, layer: 'personal' },
  { key: 'leave_request', name: 'Cuti Saya', desc: 'Pengajuan cuti karyawan', href: '/employee/leave-request', status: 'live', icon: CalendarDays, layer: 'personal' },
  { key: 'payslip', name: 'Payslip Saya', desc: 'Slip gaji karyawan', href: '/employee/payslip', status: 'live', icon: Receipt, layer: 'personal' },

  // --- Layer 2: My Work — folder HRIS (kelola data lintas karyawan) ---
  { key: 'employee_list', name: 'Employee List', desc: 'Kelola data dan akses karyawan', href: '/employee/list', status: 'live', icon: Users, layer: 'hris' },
  { key: 'absensi_admin', name: 'Kelola Absensi Tim', desc: 'Jadwal kerja, rekap bulanan, dan approval koreksi absensi semua karyawan', href: '/employee/absensi/karyawan', status: 'live', icon: ClipboardCheck, layer: 'hris' },
  { key: 'leave_request_admin', name: 'Kelola Cuti Tim', desc: 'Approval pengajuan cuti semua karyawan', href: '/employee/leave-request/admin', status: 'live', icon: CalendarCheck, layer: 'hris' },
  { key: 'payslip_admin', name: 'Kelola Payslip', desc: 'Kelola dan terbitkan payslip semua karyawan', href: '/employee/payslip/admin', status: 'live', icon: FileSpreadsheet, layer: 'hris' },
  { key: 'payroll', name: 'Payroll', desc: 'Employee master data dan struktur gaji', href: '/employee/payroll', status: 'live', icon: Wallet, layer: 'hris' },

  // --- Layer 2: My Work — modul lain, di luar folder HRIS ---
  { key: 'job_portal', name: 'Job Portal', desc: 'Kelola lowongan dan kandidat', href: '/employee/job-portal', status: 'live', icon: Briefcase, layer: 'general' },
  { key: 'crm', name: 'CRM', desc: 'Pipeline klien dan BD Madael', href: '/employee/crm', status: 'live', icon: Handshake, layer: 'general' },
  { key: 'statistics', name: 'Statistics', desc: 'Laporan dan statistik perusahaan', href: '/employee/statistics', status: 'live', icon: BarChart3, layer: 'general' },
  { key: 'kalkulator', name: 'Kalkulator', desc: 'PPh 21, BPJS, dan kalkulator lainnya', href: '/kalkulator-pph21', status: 'live', icon: Calculator, layer: 'general' },
  { key: 'document_generator', name: 'Documents', desc: 'Generate proposal, quotation, agreement, dan nomor surat', href: '/employee/documents', status: 'live', icon: FileText, altKeys: ['nomor_surat'], layer: 'general' },
  { key: 'compliance_monitor', name: 'Compliance Monitor', desc: 'Pantau kepatuhan hukum', href: '/employee/compliance-monitor', status: 'coming_soon', icon: ShieldCheck, layer: 'general' },
  { key: 'reports', name: 'Reports', desc: 'Ringkasan data lintas modul (khusus superadmin)', href: '/employee/reports', status: 'live', icon: PieChart, layer: 'general' },
  { key: 'activity_log', name: 'Activity Log', desc: 'Audit trail aksi penting lintas modul (khusus superadmin)', href: '/employee/activity-log', status: 'live', icon: History, layer: 'general' },
];

// Daftar module key yang bisa di-assign superadmin ke employee (checkbox di
// app/employee/list). Key granular (payslip_admin, nomor_surat,
// document_manage) mengontrol akses ke sub-menu/aksi spesifik di dalam modul
// induknya — independen dari akses ke modul induk itu sendiri.
export const MODULE_OPTIONS = [
  { key: 'employee_list', label: 'Employee List' },
  { key: 'job_portal', label: 'Job Portal' },
  { key: 'crm', label: 'CRM' },
  { key: 'statistics', label: 'Statistics' },
  { key: 'kalkulator', label: 'Kalkulator' },
  { key: 'absensi', label: 'Absensi' },
  { key: 'absensi_admin', label: '— Sub: Kelola Absensi Tim' },
  { key: 'payslip', label: 'Payslip' },
  { key: 'payslip_admin', label: '— Sub: Kelola Payslip' },
  { key: 'leave_request', label: 'Leave Request' },
  { key: 'leave_request_admin', label: '— Sub: Kelola Cuti Tim' },
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