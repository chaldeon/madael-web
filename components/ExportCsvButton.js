'use client';

// Tombol kecil reusable buat export satu tabel/chart data ke CSV. Dipasang
// di header tiap section Reports/Statistics — sengaja per-section (bukan
// satu tombol "export semua") supaya file yang didownload jelas isinya apa.

import { Download } from 'lucide-react';
import { downloadCsv } from '@/lib/exportCsv';

export default function ExportCsvButton({ filename, headers, rows, label = 'Export CSV' }) {
  const disabled = !rows || rows.length === 0;
  return (
    <button
      onClick={() => downloadCsv(filename, headers, rows)}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-madael-red hover:text-madael-dark disabled:opacity-40 disabled:cursor-not-allowed print:hidden shrink-0"
    >
      <Download size={13} /> {label}
    </button>
  );
}