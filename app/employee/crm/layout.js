'use client';

import ModuleLayout from '@/components/ModuleLayout';

const DEALS_PATH = '/employee/crm/deals';
const TABS = [
  {
    href: '/employee/crm',
    label: 'Perusahaan',
    isActive: (pathname) => !pathname.startsWith(DEALS_PATH),
  },
  {
    href: DEALS_PATH,
    label: 'Pipeline Deal',
    isActive: (pathname) => pathname.startsWith(DEALS_PATH),
  },
];

export default function CrmLayout({ children }) {
  return (
    <ModuleLayout moduleKeys="crm" deniedLabel="modul CRM" tabs={TABS} printHidden>
      {children}
    </ModuleLayout>
  );
}
