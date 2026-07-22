'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

// Komponen mandiri — cari employee dari auth user sendiri, jadi bisa dipakai
// di header mana pun tanpa perlu prop drilling. Kalau auth user tidak match
// ke baris manapun di tabel `employees` (mis. akun /admin lama yang bukan
// employee), komponen ini render null — aman, tidak error.
export default function NotificationBell() {
  const supabase = createClient();
  const [employeeId, setEmployeeId] = useState(null);
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef(null);

  const unreadCount = items.filter((n) => !n.is_read).length;

  const loadNotifications = useCallback(async (empId) => {
    const { data } = await supabase
      .from('notifications')
      .select('id, tipe, pesan, is_read, link, created_at')
      .eq('user_id', empId)
      .order('created_at', { ascending: false })
      .limit(20);
    setItems(data || []);
    setLoaded(true);
  }, [supabase]);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || ignore) return;

      const { data: emp } = await supabase
        .from('employees')
        .select('id')
        .eq('email', user.email)
        .maybeSingle();

      if (ignore || !emp) return;
      setEmployeeId(emp.id);
      loadNotifications(emp.id);
    })();
    return () => { ignore = true; };
  }, [supabase, loadNotifications]);

  // Polling ringan tiap 30 detik biar notif baru muncul tanpa refresh manual.
  useEffect(() => {
    if (!employeeId) return;
    const interval = setInterval(() => loadNotifications(employeeId), 30000);
    return () => clearInterval(interval);
  }, [employeeId, loadNotifications]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markAsRead = async (id) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
  };

  const markAllAsRead = async () => {
    const unreadIds = items.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds);
  };

  // Belum ketemu employee row (masih loading atau memang tidak ada) — jangan
  // tampilkan apa-apa daripada nunjukin lonceng kosong yang membingungkan.
  if (!employeeId) return null;

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 text-[#6B6B6B] hover:text-black transition-colors cursor-pointer"
        aria-label="Notifikasi"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-madael-red text-white text-[10px] font-medium leading-none rounded-full">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[320px] bg-white border border-[#E0E0E0] shadow-lg z-[1000]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E0E0E0]">
            <p className="text-sm font-medium text-black">Notifikasi</p>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="text-xs text-madael-red hover:text-madael-dark cursor-pointer"
              >
                Tandai semua dibaca
              </button>
            )}
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {!loaded ? (
              <p className="text-xs text-[#9A9A9A] text-center py-8">Memuat...</p>
            ) : items.length === 0 ? (
              <p className="text-xs text-[#9A9A9A] text-center py-8">Belum ada notifikasi.</p>
            ) : (
              items.map((n) => (
                <Link
                  key={n.id}
                  href={n.link || '#'}
                  onClick={() => { if (!n.is_read) markAsRead(n.id); setOpen(false); }}
                  className={`block px-4 py-3 border-b border-[#F4F4F4] last:border-0 no-underline hover:bg-[#FAFAFA] transition-colors ${
                    !n.is_read ? 'bg-[#FFF5F5]' : ''
                  }`}
                >
                  <p className="text-xs text-black leading-snug">{n.pesan}</p>
                  <p className="text-[10px] text-[#9A9A9A] mt-1">
                    {new Date(n.created_at).toLocaleString('id-ID', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
