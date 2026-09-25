'use client';

import { useEffect, useState } from 'react';

// Jam real-time WIB (Asia/Jakarta), berdetak tiap detik. State-nya sengaja
// dipisah di komponen ini supaya re-render per detik tidak menyentuh halaman
// induk (app/employee/absensi/page.js cukup besar).
//
// Catatan: ini menampilkan jam perangkat yang dikonversi ke zona WIB. Waktu
// clock in/out yang benar-benar tercatat tetap ditentukan server
// (lib/serverTime.js), jadi jam ini bersifat informasi tampilan saja.

const TZ = 'Asia/Jakarta';

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export default function LiveClock({ className = '' }) {
  // null saat render pertama supaya tidak ada mismatch hidrasi.
  const [now, setNow] = useState(null);

  useEffect(() => {
    let timeoutId;
    // Ketuk tepat di pergantian detik (bukan setInterval polos) agar angka
    // detik tidak bergeser/melompat seiring waktu.
    const tick = () => {
      setNow(new Date());
      timeoutId = setTimeout(tick, 1000 - (Date.now() % 1000));
    };
    timeoutId = setTimeout(tick, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <span
        role="timer"
        aria-label="Jam sekarang WIB"
        className="font-serif text-[40px] leading-none font-normal text-black tracking-[-0.02em] tabular-nums"
      >
        {now ? timeFormatter.format(now) : '--:--:--'}
      </span>
      <span className="text-xs font-medium tracking-[0.08em] text-[#9A9A9A]">WIB</span>
    </div>
  );
}
