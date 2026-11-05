'use client';

import ModuleLayout from '@/components/ModuleLayout';

const KARYAWAN_PATH = '/employee/absensi/karyawan';
const KOREKSI_PATH = '/employee/absensi/koreksi';
const MODULE_KEYS = ['absensi', 'absensi_admin'];
const TABS = [
  {
    href: '/employee/absensi',
    label: 'Absensi Saya',
    moduleKey: 'absensi',
    isActive: (pathname) => !pathname.startsWith(KARYAWAN_PATH) && !pathname.startsWith(KOREKSI_PATH),
  },
  {
    href: KARYAWAN_PATH,
    label: 'Semua Karyawan',
    moduleKey: 'absensi_admin',
    isActive: (pathname) => pathname.startsWith(KARYAWAN_PATH),
  },
  // Koreksi manual oleh HR (tambah/ubah record absensi). Halamannya sudah ada
  // dan API-nya (/api/attendance/koreksi/manual) hanya dipanggil dari sana,
  // tetapi sebelumnya tidak ada tautan masuk sama sekali.
  {
    href: KOREKSI_PATH,
    label: 'Koreksi Manual',
    moduleKey: 'absensi_admin',
    isActive: (pathname) => pathname.startsWith(KOREKSI_PATH),
  },
];

export default function AbsensiLayout({ children }) {
  return (
    <ModuleLayout moduleKeys={MODULE_KEYS} deniedLabel="halaman Absensi" tabs={TABS}>
      {children}
    </ModuleLayout>
  );
}
