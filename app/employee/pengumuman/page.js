'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Megaphone, Pin, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { friendlyError } from '@/lib/errorMessage';
import { activeAnnouncementsQuery, isActive, isForCompany } from '@/lib/announcements';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

function formatTanggal(value) {
  return new Date(value).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta',
  });
}

export default function PengumumanPage() {
  const router = useRouter();
  const supabase = createClient();

  const [employee, setEmployee] = useState(null);
  const [items, setItems] = useState([]);
  const [readIds, setReadIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [marking, setMarking] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'

  // Query dan penyaringan sama dengan banner di Dashboard (lib/announcements.js),
  // bedanya semua pengumuman aktif ditampilkan — yang sudah dibaca tidak hilang.
  const init = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/employee/login');
      return;
    }

    const { data: emp, error: empError } = await supabase
      .from('employees')
      .select('id, client_id')
      .eq('email', user.email)
      .maybeSingle();

    if (empError) {
      setLoadError(friendlyError(empError, 'Data karyawan tidak ditemukan.'));
      setLoading(false);
      return;
    }

    if (!emp) {
      setEmployee(null);
      setItems([]);
      setLoading(false);
      return;
    }

    const [annRes, readRes] = await Promise.all([
      fetchAllRows(() => activeAnnouncementsQuery(supabase, emp.client_id)),
      supabase.from('announcement_reads').select('announcement_id').eq('employee_id', emp.id),
    ]);

    const firstError = annRes.error || readRes.error;
    if (firstError) {
      setLoadError(friendlyError(firstError, 'Gagal memuat pengumuman.'));
      setLoading(false);
      return;
    }

    setLoadError(null);
    setEmployee(emp);
    setItems((annRes.data || []).filter((a) => isActive(a) && isForCompany(a, emp.client_id)));
    setReadIds((readRes.data || []).map((r) => r.announcement_id));
    setLoading(false);
  }, [supabase, router]);

  useEffect(() => {
    (async () => { await init(); })();
  }, [init]);

  const unreadCount = useMemo(
    () => items.filter((a) => !readIds.includes(a.id)).length,
    [items, readIds]
  );

  const visible = useMemo(
    () => (filter === 'unread' ? items.filter((a) => !readIds.includes(a.id)) : items),
    [items, readIds, filter]
  );

  const markAsRead = async (announcementId) => {
    if (!employee) return;
    setActionError(null);
    setMarking(announcementId);
    const { error } = await supabase
      .from('announcement_reads')
      .insert([{ announcement_id: announcementId, employee_id: employee.id }]);
    setMarking(null);

    // 23505 = sudah pernah ditandai (mis. lewat banner di tab lain) — hasil akhirnya sama.
    if (error && error.code !== '23505') {
      setActionError(friendlyError(error, 'Gagal menandai pengumuman sebagai dibaca.'));
      return;
    }
    setReadIds((prev) => (prev.includes(announcementId) ? prev : [...prev, announcementId]));
  };

  if (loading) {
    return (
      <div className="max-w-[760px] mx-auto px-6 py-10">
        <LoadingState label="Memuat pengumuman..." />
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

  const emptyMessage = !employee
    ? 'Akun ini tidak terhubung dengan data karyawan.'
    : items.length === 0
      ? 'Belum ada pengumuman yang berlaku.'
      : 'Semua pengumuman sudah kamu baca.';

  return (
    <div className="max-w-[760px] mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Pengumuman</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">
          Semua pengumuman yang masih berlaku, termasuk yang sudah kamu baca.
          {unreadCount > 0 ? ` ${unreadCount} belum dibaca.` : ''}
        </p>
      </div>

      {actionError && <p className="text-xs text-red-600 mb-4">{actionError}</p>}

      <div className="flex mb-4">
        <button type="button" onClick={() => setFilter('all')} className={filterButtonClass(filter === 'all')}>
          Semua
        </button>
        <button
          type="button"
          onClick={() => setFilter('unread')}
          className={`${filterButtonClass(filter === 'unread')} -ml-px`}
        >
          Belum dibaca{unreadCount > 0 ? ` (${unreadCount})` : ''}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message={emptyMessage} icon={Megaphone} />
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((a) => {
            const isRead = readIds.includes(a.id);
            const Icon = a.pinned ? Pin : Megaphone;
            return (
              <div
                key={a.id}
                className={`border-l-4 bg-white p-4 flex items-start gap-3 ${isRead ? 'border-[#C9C9C9]' : 'border-madael-red'}`}
              >
                <Icon size={18} className={`shrink-0 mt-0.5 ${isRead ? 'text-[#9A9A9A]' : 'text-madael-red'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-black">{a.judul}</p>
                  <p className="text-xs text-[#6B6B6B] mt-1 whitespace-pre-wrap">{a.isi}</p>
                  <p className="text-[11px] text-[#9A9A9A] mt-2">
                    {formatTanggal(a.created_at)}
                    {a.pinned ? ' · Disematkan admin' : ''}
                    {a.expired_at ? ` · Berlaku sampai ${formatTanggal(a.expired_at)}` : ''}
                    {isRead ? ' · Sudah dibaca' : ''}
                  </p>
                </div>
                {!isRead && (
                  <button
                    type="button"
                    onClick={() => markAsRead(a.id)}
                    disabled={marking === a.id}
                    className="shrink-0 flex items-center gap-1 text-xs font-medium text-madael-red hover:text-madael-dark disabled:opacity-50 cursor-pointer"
                  >
                    <Check size={14} />
                    {marking === a.id ? 'Memproses...' : 'Tandai dibaca'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
