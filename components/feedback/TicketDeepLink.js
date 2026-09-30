'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Listener({ param, onOpen }) {
  const value = useSearchParams().get(param);

  useEffect(() => {
    if (!value) return;
    if (UUID_RE.test(value)) onOpen(value);
    // Buang param supaya refresh / klik ulang notifikasi yang sama tetap berfungsi.
    const url = new URL(window.location.href);
    url.searchParams.delete(param);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [value, param, onOpen]);

  return null;
}

// Deep link dari lonceng notifikasi: membuka tiket sesuai query param.
//   ?tiket=<id>   -> bubble pengguna (FeedbackBubble)
//   ?kelola=<id>  -> panel admin (/employee/support)
// Dibungkus Suspense di sini supaya useSearchParams tidak membuat halaman induk
// kehilangan pre-render. `onOpen` harus stabil (setState / useCallback).
export default function TicketDeepLink({ param, onOpen }) {
  return (
    <Suspense fallback={null}>
      <Listener param={param} onOpen={onOpen} />
    </Suspense>
  );
}
