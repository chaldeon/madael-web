'use client';

import ModuleLayout from '@/components/ModuleLayout';

const ADMIN_PATH = '/employee/leave-request/admin';
const MODULE_KEYS = ['leave_request', 'leave_request_admin'];
const TABS = [
  {
    href: '/employee/leave-request',
    label: 'Ajukan Cuti',
    moduleKey: 'leave_request',
    isActive: (pathname) => !pathname.startsWith(ADMIN_PATH),
  },
  {
    href: ADMIN_PATH,
    label: 'Kelola Pengajuan',
    moduleKey: 'leave_request_admin',
    isActive: (pathname) => pathname.startsWith(ADMIN_PATH),
  },
];

export default function LeaveRequestLayout({ children }) {
  return (
    <ModuleLayout moduleKeys={MODULE_KEYS} deniedLabel="modul Leave Request" tabs={TABS}>
      {children}
    </ModuleLayout>
  );
}
