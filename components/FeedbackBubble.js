'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowLeft, LifeBuoy, X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import NewTicketForm from '@/components/feedback/NewTicketForm';
import TicketList from '@/components/feedback/TicketList';
import TicketThread from '@/components/feedback/TicketThread';
import { api } from '@/components/feedback/parts';

// Halaman /employee/* yang belum butuh sesi login — bubble disembunyikan.
const HIDDEN_PATHS = [
  '/employee/login',
  '/employee/forgot-password',
  '/employee/reset-password',
  '/employee/set-password',
];

const UNREAD_POLL_MS = 60 * 1000;

// Deep link dari lonceng notifikasi: ?tiket=<id> membuka bubble langsung ke
// tiketnya. Dipisah + dibungkus Suspense supaya useSearchParams tidak membuat
// halaman-halaman /employee/* kehilangan pre-render.
function TicketDeepLink({ onOpenTicket }) {
  const tiket = useSearchParams().get('tiket');

  useEffect(() => {
    if (!tiket) return;
    onOpenTicket(tiket);
    // Buang param supaya refresh / klik ulang notifikasi yang sama tetap berfungsi.
    const url = new URL(window.location.href);
    url.searchParams.delete('tiket');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [tiket, onOpenTicket]);

  return null;
}

// Bubble feedback mengambang untuk semua halaman /employee/* (dipasang di
// app/employee/layout.js). Komponen mandiri: cek sesi sendiri, render null
// kalau belum login / akun tidak aktif.
//
// Badge = jumlah TIKET yang punya balasan support belum dibuka (bukan tanda
// seru): angka memberi tahu seberapa banyak, dan hilang sendiri begitu tiketnya
// dibuka. Di-poll tiap 60 detik saat tab terlihat + saat tab kembali aktif.
export default function FeedbackBubble() {
  const pathname = usePathname();
  const [supabase] = useState(() => createClient());
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('new'); // 'new' | 'list' | 'thread'
  const [threadId, setThreadId] = useState(null);
  const [unread, setUnread] = useState(0);

  const hidden = HIDDEN_PATHS.includes(pathname);

  useEffect(() => {
    if (hidden) {
      setReady(false);
      setOpen(false);
      setUnread(0);
      return;
    }
    if (ready) return;
    let ignore = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || ignore) return;
      const { data: emp } = await supabase
        .from('employees')
        .select('id, status')
        .eq('email', user.email)
        .maybeSingle();
      if (!ignore && emp?.status === 'Aktif') setReady(true);
    })();
    return () => { ignore = true; };
  }, [hidden, ready, pathname, supabase]);

  const refreshUnread = useCallback(async () => {
    const res = await api('/api/feedback/unread');
    if (res.ok) setUnread(res.data.count || 0);
  }, []);

  useEffect(() => {
    if (!ready) return;
    refreshUnread();
    const tick = () => {
      if (document.visibilityState === 'visible') refreshUnread();
    };
    const interval = setInterval(tick, UNREAD_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [ready, refreshUnread]);

  const openThread = useCallback((id) => {
    setThreadId(id);
    setView('thread');
    setOpen(true);
  }, []);

  if (hidden || !ready) return null;

  const toggleOpen = () => {
    // Ada balasan baru: langsung tampilkan daftar tiket, bukan form kosong.
    if (!open && unread > 0 && view === 'new') setView('list');
    setOpen((o) => !o);
  };

  return (
    <>
      <Suspense fallback={null}>
        <TicketDeepLink onOpenTicket={openThread} />
      </Suspense>

      {open && (
        <div
          role="dialog"
          aria-label="Pusat Bantuan"
          className="print:hidden fixed right-4 sm:right-7 bottom-[92px] z-[1000] w-[380px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-116px)] flex flex-col bg-white border border-[#E0E0E0] border-t-4 border-t-madael-red shadow-[0_8px_30px_rgba(0,0,0,0.15)]"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E0E0E0]">
            {view === 'thread' ? (
              <button onClick={() => setView('list')} className="flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-black">
                <ArrowLeft size={16} />
                Tiket Saya
              </button>
            ) : (
              <h2 className="font-serif text-[17px] font-normal text-black">Pusat Bantuan</h2>
            )}
            <button onClick={() => setOpen(false)} aria-label="Tutup" className="text-[#6B6B6B] hover:text-black">
              <X size={18} />
            </button>
          </div>

          {view !== 'thread' && (
            <div className="flex border-b border-[#E0E0E0] px-4">
              {[['new', 'Kirim Tiket'], ['list', unread > 0 ? `Tiket Saya (${unread} baru)` : 'Tiket Saya']].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={`px-3 py-2.5 text-xs font-medium border-b-2 -mb-px ${
                    view === key ? 'border-madael-red text-black' : 'border-transparent text-[#6B6B6B] hover:text-black'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="overflow-y-auto">
            {view === 'new' && <NewTicketForm pathname={pathname} onCreated={openThread} />}
            {view === 'list' && <TicketList onOpen={openThread} />}
            {view === 'thread' && <TicketThread id={threadId} onRead={refreshUnread} />}
          </div>
        </div>
      )}

      <button
        onClick={toggleOpen}
        aria-label={unread > 0 ? `Buka Pusat Bantuan, ${unread} tiket punya balasan baru` : 'Buka Pusat Bantuan'}
        title="Bantuan & Feedback"
        className="print:hidden fixed bottom-7 right-4 sm:right-7 w-[52px] h-[52px] bg-madael-red text-white rounded-full flex items-center justify-center shadow-[0_4px_16px_rgba(193,39,45,0.35)] cursor-pointer z-[998] transition-transform hover:scale-[1.08] hover:bg-madael-dark"
      >
        {open ? <X size={22} /> : <LifeBuoy size={24} />}
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 flex items-center justify-center rounded-full bg-white text-madael-red border-2 border-madael-red text-[11px] font-bold leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    </>
  );
}
