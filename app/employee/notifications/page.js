'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, CheckCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { friendlyError } from '@/lib/errorMessage';
import {
  getNotificationMeta,
  NOTIFICATION_CATEGORY_OPTIONS,
  NOTIFICATIONS_CHANGED_EVENT,
} from '@/lib/notificationTypes';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

// Jumlah notifikasi yang ditampilkan per "halaman" — seluruh data dimuat sekali
// (fetchAllRows), lalu ditampilkan bertahap lewat tombol "Tampilkan lebih banyak".
const PAGE_SIZE = 30;

function formatWaktu(value) {
  return new Date(value).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function NotificationsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [employeeId, setEmployeeId] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);

  const [readFilter, setReadFilter] = useState('all'); // 'all' | 'unread'
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Muat seluruh notifikasi milik satu employee. Tidak ada setState sinkron di
  // awal fungsi (state awal sudah `loading`); pemanggil yang mengatur ulang
  // loading/error bila perlu (tombol "Coba Lagi").
  const loadNotifications = useCallback(async (empId) => {
    const { data, error } = await fetchAllRows(() =>
      supabase
        .from('notifications')
        .select('id, tipe, pesan, is_read, link, created_at')
        .eq('user_id', empId)
        .order('created_at', { ascending: false })
    );

    if (error) {
      setLoadError(friendlyError(error, 'Gagal memuat notifikasi.'));
      setLoading(false);
      return;
    }

    // fetchAllRows menambahkan urutan `id` di belakang urutan kita; urutkan ulang
    // di client supaya yang terbaru tetap di atas.
    setLoadError(null);
    setItems(
      [...data].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    );
    setLoading(false);
  }, [supabase]);

  // Cari employee dari auth user (pola sama seperti NotificationBell), lalu muat
  // notifikasinya.
  const init = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/employee/login');
      return;
    }

    const { data: emp, error: empError } = await supabase
      .from('employees')
      .select('id, status')
      .eq('email', user.email)
      .maybeSingle();

    if (empError) {
      setLoadError(friendlyError(empError, 'Data karyawan tidak ditemukan.'));
      setLoading(false);
      return;
    }

    // Akun yang bukan employee aktif tidak punya notifikasi (sama seperti lonceng).
    if (!emp || emp.status !== 'Aktif') {
      setEmployeeId(null);
      setItems([]);
      setLoading(false);
      return;
    }

    setEmployeeId(emp.id);
    await loadNotifications(emp.id);
  }, [supabase, router, loadNotifications]);

  useEffect(() => {
    (async () => { await init(); })();
  }, [init]);

  // Lonceng di header juga bisa menandai dibaca — ikut segarkan daftar ini.
  useEffect(() => {
    if (!employeeId) return;
    function handleChanged(e) {
      if (e.detail?.source === 'page') return;
      loadNotifications(employeeId);
    }
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, handleChanged);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, handleChanged);
  }, [employeeId, loadNotifications]);

  const announceChanged = () => {
    window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT, { detail: { source: 'page' } }));
  };

  const unreadCount = useMemo(() => items.filter((n) => !n.is_read).length, [items]);

  const filtered = useMemo(
    () =>
      items.filter((n) => {
        if (readFilter === 'unread' && n.is_read) return false;
        if (categoryFilter !== 'all' && getNotificationMeta(n.tipe).categoryKey !== categoryFilter) {
          return false;
        }
        return true;
      }),
    [items, readFilter, categoryFilter]
  );

  const visible = filtered.slice(0, visibleCount);

  const changeReadFilter = (value) => {
    setReadFilter(value);
    setVisibleCount(PAGE_SIZE);
  };

  const changeCategoryFilter = (value) => {
    setCategoryFilter(value);
    setVisibleCount(PAGE_SIZE);
  };

  const markAsRead = async (id) => {
    setActionError(null);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    if (error) {
      setActionError(friendlyError(error, 'Gagal menandai notifikasi sebagai dibaca.'));
      loadNotifications(employeeId);
      return;
    }
    announceChanged();
  };

  const markAllAsRead = async () => {
    if (!employeeId || unreadCount === 0) return;
    setActionError(null);
    setMarkingAll(true);
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', employeeId)
      .eq('is_read', false);
    setMarkingAll(false);

    if (error) {
      setActionError(friendlyError(error, 'Gagal menandai semua notifikasi sebagai dibaca.'));
      return;
    }
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    announceChanged();
  };

  if (loading) {
    return (
      <div className="max-w-[760px] mx-auto px-6 py-10">
        <LoadingState label="Memuat notifikasi..." />
      </div>
    );
  }

  if (loadError) {
    const retry = () => {
      setLoading(true);
      setLoadError(null);
      init();
    };
    return (
      <div className="max-w-[760px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={retry} />
      </div>
    );
  }

  const filterButtonClass = (active) =>
    `px-4 py-2 text-xs font-medium tracking-[0.02em] border transition-colors cursor-pointer ${
      active
        ? 'bg-madael-red text-white border-madael-red'
        : 'bg-white text-[#6B6B6B] border-[#E0E0E0] hover:text-black'
    }`;

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-xs text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  const emptyMessage = !employeeId
    ? 'Akun ini tidak memiliki notifikasi.'
    : items.length === 0
      ? 'Belum ada notifikasi.'
      : 'Tidak ada notifikasi yang cocok dengan filter ini.';

  return (
    <div className="max-w-[760px] mx-auto px-6 py-10">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Pusat Notifikasi</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">
            Semua notifikasi akunmu, dari yang terbaru.
            {unreadCount > 0 ? ` ${unreadCount} belum dibaca.` : ''}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllAsRead}
            disabled={markingAll}
            className="shrink-0 flex items-center gap-2 text-xs font-medium text-madael-red hover:text-madael-dark disabled:opacity-50 cursor-pointer"
          >
            <CheckCheck size={14} />
            {markingAll ? 'Memproses...' : 'Tandai semua dibaca'}
          </button>
        )}
      </div>

      {actionError && <p className="text-xs text-red-600 mb-4">{actionError}</p>}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex">
          <button
            type="button"
            onClick={() => changeReadFilter('all')}
            className={filterButtonClass(readFilter === 'all')}
          >
            Semua
          </button>
          <button
            type="button"
            onClick={() => changeReadFilter('unread')}
            className={`${filterButtonClass(readFilter === 'unread')} -ml-px`}
          >
            Belum dibaca{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </button>
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => changeCategoryFilter(e.target.value)}
          className={selectClass}
          aria-label="Filter kategori"
        >
          <option value="all">Semua kategori</option>
          {NOTIFICATION_CATEGORY_OPTIONS.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-[#E0E0E0]">
        {visible.length === 0 ? (
          <EmptyState message={emptyMessage} icon={Bell} />
        ) : (
          visible.map((n) => {
            const { Icon, iconClass, label } = getNotificationMeta(n.tipe);
            const rowClass = `flex items-start gap-3 w-full text-left px-5 py-4 border-b border-[#F4F4F4] last:border-0 no-underline hover:bg-[#FAFAFA] transition-colors ${
              !n.is_read ? 'bg-[#FFF5F5]' : ''
            }`;
            const content = (
              <>
                <span
                  className={`shrink-0 mt-0.5 w-8 h-8 flex items-center justify-center rounded-full ${iconClass}`}
                  aria-hidden="true"
                >
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-black leading-snug">{n.pesan}</span>
                  <span className="block text-xs text-[#9A9A9A] mt-1">
                    {label} · {formatWaktu(n.created_at)}
                  </span>
                </span>
                {!n.is_read && (
                  <span
                    className="shrink-0 mt-2 w-2 h-2 rounded-full bg-madael-red"
                    title="Belum dibaca"
                    aria-label="Belum dibaca"
                  />
                )}
              </>
            );

            // Tanpa link: tidak ada tujuan, jadi klik hanya menandai dibaca
            // (bukan tautan ke '#').
            return n.link ? (
              <Link
                key={n.id}
                href={n.link}
                onClick={() => { if (!n.is_read) markAsRead(n.id); }}
                className={rowClass}
              >
                {content}
              </Link>
            ) : (
              <button
                key={n.id}
                type="button"
                onClick={() => { if (!n.is_read) markAsRead(n.id); }}
                className={`${rowClass} ${n.is_read ? 'cursor-default' : 'cursor-pointer'}`}
              >
                {content}
              </button>
            );
          })
        )}
      </div>

      {filtered.length > visibleCount && (
        <div className="flex justify-center mt-4">
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="border border-[#E0E0E0] bg-white px-5 py-2 text-xs font-medium text-[#6B6B6B] hover:text-black transition-colors cursor-pointer"
          >
            Tampilkan lebih banyak ({filtered.length - visibleCount} lagi)
          </button>
        </div>
      )}
    </div>
  );
}
