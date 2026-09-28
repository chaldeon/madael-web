'use client';

// Kontrol istirahat (break-in / break-out) untuk karyawan: slide "geser untuk mulai
// istirahat" -> saat sedang istirahat tampil info + slide "geser untuk selesai".
// Dipakai bersama oleh halaman Absensi dan widget "Absen Cepat" di dashboard, dengan
// logika dari useAttendanceClock (handleBreak) — jangan duplikasi fetch-nya di sini.
//
// Tidak menampilkan apa-apa kalau belum clock in atau sudah clock out tanpa istirahat
// (baris clock in/out sendiri sudah menjelaskan statusnya).

import { useEffect, useState } from 'react';
import { Coffee } from 'lucide-react';
import SlideToConfirm from '@/components/SlideToConfirm';
import { getBreakState, durasiIstirahatMenit, formatDurasi } from '@/lib/attendanceBreak';

function formatWaktu(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export default function BreakControl({ row, breaking, breakError, onBreak }) {
  const state = getBreakState(row);

  // Detak per 30 detik hanya saat sedang istirahat, untuk durasi berjalan.
  // null saat render pertama supaya tidak ada mismatch hidrasi.
  const [now, setNow] = useState(null);
  useEffect(() => {
    if (state !== 'sedang') return undefined;
    let timeoutId;
    const tick = () => {
      setNow(new Date().toISOString());
      timeoutId = setTimeout(tick, 30000);
    };
    timeoutId = setTimeout(tick, 0);
    return () => clearTimeout(timeoutId);
  }, [state]);

  if (state !== 'siap' && state !== 'sedang' && state !== 'selesai') return null;

  return (
    <div className="space-y-2">
      {state === 'siap' && (
        <SlideToConfirm
          label="Geser untuk mulai istirahat"
          busy={breaking}
          onConfirm={() => onBreak('start')}
        />
      )}

      {state === 'sedang' && (
        <>
          <p className="flex items-center gap-2 text-sm text-black">
            <Coffee size={15} className="text-madael-red" />
            <span>
              Istirahat sejak {formatWaktu(row.break_start)}
              {now && (
                <span className="text-[#6B6B6B]"> · {formatDurasi(durasiIstirahatMenit(row, now))}</span>
              )}
            </span>
          </p>
          <SlideToConfirm
            label="Geser untuk selesai istirahat"
            busy={breaking}
            onConfirm={() => onBreak('end')}
          />
        </>
      )}

      {state === 'selesai' && (
        <p className="flex items-center gap-2 text-sm text-black">
          <Coffee size={15} className="text-[#9A9A9A]" />
          <span>
            Istirahat {formatWaktu(row.break_start)} – {formatWaktu(row.break_end)}
            <span className="text-[#6B6B6B]"> · {formatDurasi(durasiIstirahatMenit(row))}</span>
          </span>
        </p>
      )}

      {breakError && (
        <p className="text-xs text-red-600" role="alert">{breakError}</p>
      )}
    </div>
  );
}
