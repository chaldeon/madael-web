'use client';

import ModuleLayout from '@/components/ModuleLayout';
import { FREELANCER_ADMIN_MODULE } from '@/lib/freelancerModules';

// Gate halaman admin Freelancer di sisi browser (kenyamanan UI). Penjaga yang
// sebenarnya adalah API /api/freelancers/* (requireModuleAccess di server).
const MODULE_KEYS = [FREELANCER_ADMIN_MODULE];

export default function FreelancerAdminLayout({ children }) {
  return (
    <ModuleLayout moduleKeys={MODULE_KEYS} deniedLabel="modul Kelola Freelancer">
      {children}
    </ModuleLayout>
  );
}
