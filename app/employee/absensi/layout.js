'use client';

import ModuleLayout from '@/components/ModuleLayout';

const KARYAWAN_PATH = '/employee/absensi/karyawan';
const MODULE_KEYS = ['absensi', 'absensi_admin'];
const TABS = [
  {
    href: '/employee/absensi',
    label: 'Absensi Saya',
    moduleKey: 'absensi',
    isActive: (pathname) => !pathname.startsWith(KARYAWAN_PATH),
  },
  {
    href: KARYAWAN_PATH,
    label: 'Semua Karyawan',
    moduleKey: 'absensi_admin',
    isActive: (pathname) => pathname.startsWith(KARYAWAN_PATH),
  },
];

export default function AbsensiLayout({ children }) {
  return (
    <ModuleLayout moduleKeys={MODULE_KEYS} deniedLabel="halaman Absensi" tabs={TABS}>
      {children}
    </ModuleLayout>
  );
}
