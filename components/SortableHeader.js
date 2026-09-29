'use client';

import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';

// Header kolom tabel yang bisa diklik buat sortir. align="right" untuk kolom
// angka (ikon di kiri label, rata kanan).
export default function SortableHeader({ colKey, label, sortField, sortDir, onSort, className = 'px-5 py-3', align }) {
  const active = sortField === colKey;
  const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  const right = align === 'right';
  const ariaSort = active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  return (
    <th className={`${className} font-medium ${right ? 'text-right' : ''}`} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={() => onSort(colKey)}
        aria-label={`Urutkan berdasarkan ${label}${active ? (sortDir === 'asc' ? ', sedang A-Z' : ', sedang Z-A') : ''}`}
        className={`flex items-center gap-1.5 hover:text-black transition-colors ${right ? 'ml-auto' : ''} ${active ? 'text-black' : ''}`}
      >
        {right && <Icon size={12} className={active ? 'text-madael-red' : 'text-[#B0B0B0]'} aria-hidden="true" />}
        {label}
        {!right && <Icon size={12} className={active ? 'text-madael-red' : 'text-[#B0B0B0]'} aria-hidden="true" />}
      </button>
    </th>
  );
}
