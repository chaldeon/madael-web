'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowLeft, LifeBuoy, X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import NewTicketForm from '@/components/feedback/NewTicketForm';
import TicketList from '@/components/feedback/TicketList';
import TicketThread from '@/components/feedback/TicketThread';

// Halaman /employee/* yang belum butuh sesi login — bubble disembunyikan.
const HIDDEN_PATHS = [
  '/employee/login',
  '/employee/forgot-password',
  '/employee/reset-password',
  '/employee/set-password',
];

// Bubble feedback mengambang untuk semua halaman /employee/* (dipasang di
// app/employee/layout.js). Komponen mandiri: cek sesi sendiri, render null
// kalau belum login / akun tidak aktif.
export default function FeedbackBubble() {
  const pathname = usePathname();
  const [supabase] = useState(() => createClient());
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('new'); // 'new' | 'list' | 'thread'
  const [threadId, setThreadId] = useState(null);

  const hidden = HIDDEN_PATHS.includes(pathname);

  useEffect(() => {
    if (hidden) {
      setReady(false);
      setOpen(false);
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

  if (hidden || !ready) return null;

  const openThread = (id) => {
    setThreadId(id);
    setView('thread');
  };

  return (
    <>
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
              {[['new', 'Kirim Tiket'], ['list', 'Tiket Saya']].map(([key, label]) => (
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
            {view === 'thread' && <TicketThread id={threadId} />}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Buka Pusat Bantuan"
        title="Bantuan & Feedback"
        className="print:hidden fixed bottom-7 right-4 sm:right-7 w-[52px] h-[52px] bg-madael-red text-white rounded-full flex items-center justify-center shadow-[0_4px_16px_rgba(193,39,45,0.35)] cursor-pointer z-[998] transition-transform hover:scale-[1.08] hover:bg-madael-dark"
      >
        {open ? <X size={22} /> : <LifeBuoy size={24} />}
      </button>
    </>
  );
}
