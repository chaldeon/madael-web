'use client';

import { getCompletenessInfo } from '@/lib/dataCompleteness';

// Nonaktif tidak dinilai kelengkapannya — kosong di situ tidak relevan
// sampai diaktifkan lagi.
export default function CompletenessBadge({ emp, master, hasSchedule }) {
  if (emp.status !== 'Aktif') {
    return <span className="text-xs text-[#B0B0B0]">—</span>;
  }
  const info = getCompletenessInfo({ master, hasSchedule });
  const styles = {
    complete: 'bg-[#DCFCE7] text-[#166534]',
    warning: 'bg-amber-100 text-amber-800',
    critical: 'bg-red-100 text-red-700',
  };
  return (
    <span
      title={info.missing.length ? `Kosong: ${info.missing.join(', ')}` : undefined}
      className={`inline-block whitespace-nowrap text-xs font-medium px-2.5 py-1 ${styles[info.level]}`}
    >
      {info.label}
    </span>
  );
}
