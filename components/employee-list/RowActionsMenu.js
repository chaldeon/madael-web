'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MoreVertical, ShieldCheck, Power, Trash2, FileText } from 'lucide-react';

// Menu aksi per baris ("⋯") — pengganti 3 icon polos yang cuma punya title
// tooltip (tidak kebaca di layar sentuh). Klik di luar / Esc menutup menu.
export default function RowActionsMenu({ emp, canDelete, onManageAccess, onToggleStatus, onDelete, togglingThis }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function handleEscape(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const item = (label, Icon, onClick, extraClass = '') => (
    <button
      type="button"
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-[#F4F4F4] transition-colors ${extraClass}`}
    >
      <Icon size={14} />
      {label}
    </button>
  );

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Aksi untuk ${emp.nama}`}
        disabled={togglingThis}
        className="inline-flex p-1.5 text-[#6B6B6B] hover:text-black hover:bg-[#F4F4F4] transition-colors disabled:opacity-40"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-52 bg-white border border-[#E0E0E0] shadow-lg z-20 py-1"
        >
          <Link
            href={`/employee/list/dokumen/${emp.id}`}
            onClick={() => setOpen(false)}
            role="menuitem"
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-[#F4F4F4] transition-colors text-black"
          >
            <FileText size={14} />
            Lihat Dokumen
          </Link>
          {item('Kelola Akses', ShieldCheck, () => onManageAccess(emp), 'text-black')}
          {item(
            emp.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan',
            Power,
            () => onToggleStatus(emp),
            emp.status === 'Aktif' ? 'text-madael-red' : 'text-[#166534]'
          )}
          {canDelete && item('Hapus Permanen', Trash2, () => onDelete(emp), 'text-madael-red')}
        </div>
      )}
    </div>
  );
}
