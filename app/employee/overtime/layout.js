'use client';

import ModuleLayout from '@/components/ModuleLayout';

const ADMIN_PATH = '/employee/overtime/admin';
const MODULE_KEYS = ['overtime', 'overtime_admin'];
const TABS = [
  {
    href: '/employee/overtime',
    label: 'Ajukan Lembur',
    moduleKey: 'overtime',
    isActive: (pathname) => !pathname.startsWith(ADMIN_PATH),
  },
  {
    href: ADMIN_PATH,
    label: 'Kelola Lembur',
    moduleKey: 'overtime_admin',
    isActive: (pathname) => pathname.startsWith(ADMIN_PATH),
  },
];

export default function OvertimeLayout({ children }) {
  return (
    <ModuleLayout moduleKeys={MODULE_KEYS} deniedLabel="modul Lembur" tabs={TABS}>
      {children}
    </ModuleLayout>
  );
}
