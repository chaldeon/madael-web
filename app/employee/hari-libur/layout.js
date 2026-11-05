'use client';

import ModuleLayout from '@/components/ModuleLayout';

// Modul hari_libur bertanda superadminOnly di lib/employeeModules.js, jadi
// useModuleAccess (lewat isModuleGranted) otomatis menolak non-superadmin.
export default function HariLiburLayout({ children }) {
  return (
    <ModuleLayout moduleKeys="hari_libur" deniedLabel="modul Hari Libur (khusus superadmin)">
      {children}
    </ModuleLayout>
  );
}
