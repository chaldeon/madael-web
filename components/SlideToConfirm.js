'use client';

// Slider "geser untuk konfirmasi" (dipakai untuk mulai/selesai istirahat).
// Karyawan menggeser handle sampai ujung kanan; kalau sudah melewati ambang,
// `onConfirm` dipanggil. Kalau dilepas sebelum ambang, handle kembali ke awal.
//
// Aksesibilitas: handle adalah <button>, jadi bisa difokus dan diaktifkan lewat
// keyboard / screen reader (Enter, Spasi, atau "klik" dari teknologi bantu) tanpa
// perlu menggeser. Klik dari gestur geser/tap biasa (event.detail > 0) sengaja
// diabaikan supaya tap tidak sengaja tidak langsung mencatat istirahat.
//
// onConfirm boleh async. Handle dikunci selama onConfirm berjalan (atau `busy`),
// lalu dikembalikan ke posisi awal — kalau aksinya berhasil, induk biasanya
// sudah mengganti tampilan (label/mode) saat itu.
// onConfirm HARUS menangani error-nya sendiri (seperti handleBreak di
// useAttendanceClock, yang menyimpan pesan error ke state). Kalau ia melempar,
// handle tetap pulih, tapi error-nya lolos sebagai unhandled rejection.

import { useRef, useState } from 'react';
import { ChevronsRight, Loader2 } from 'lucide-react';

const HANDLE_WIDTH = 48; // px
const CONFIRM_RATIO = 0.9; // seberapa jauh (0–1) handle harus digeser

export default function SlideToConfirm({ label, onConfirm, disabled = false, busy = false }) {
  const trackRef = useRef(null);
  const startXRef = useRef(0);
  const lockedRef = useRef(false); // cegah konfirmasi ganda

  const [offset, setOffset] = useState(0);
  const [maxOffset, setMaxOffset] = useState(0); // jarak geser maksimum (px), diukur saat mulai geser
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);

  const inactive = disabled || busy || running;

  const runConfirm = async () => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setRunning(true);
    try {
      await onConfirm();
    } finally {
      lockedRef.current = false;
      setRunning(false);
      setOffset(0);
    }
  };

  const handlePointerDown = (e) => {
    if (inactive || !trackRef.current) return;
    setMaxOffset(Math.max(trackRef.current.clientWidth - HANDLE_WIDTH - 2, 1));
    startXRef.current = e.clientX - offset;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (e) => {
    if (!dragging) return;
    const next = Math.min(Math.max(e.clientX - startXRef.current, 0), maxOffset);
    setOffset(next);
  };

  const finishDrag = (e) => {
    if (!dragging) return;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (maxOffset > 0 && offset >= maxOffset * CONFIRM_RATIO) {
      setOffset(maxOffset);
      runConfirm();
    } else {
      setOffset(0);
    }
  };

  // Aktivasi keyboard / teknologi bantu: klik tanpa gestur (detail === 0).
  const handleClick = (e) => {
    if (e.detail === 0 && !inactive) runConfirm();
  };

  const progress = maxOffset > 0 ? Math.min(offset / maxOffset, 1) : 0;

  return (
    <div
      ref={trackRef}
      className={`relative h-12 border border-[#E0E0E0] bg-[#F4F4F4] overflow-hidden select-none ${
        inactive && !running && !busy ? 'opacity-60' : ''
      }`}
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 bg-madael-red/10"
        style={{
          width: offset + HANDLE_WIDTH,
          transition: dragging ? 'none' : 'width 200ms ease-out',
        }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center pl-12 text-xs font-medium tracking-[0.02em] text-[#6B6B6B]"
        style={{ opacity: 1 - progress }}
      >
        {label}
      </span>
      <button
        type="button"
        aria-label={label}
        disabled={inactive}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClick={handleClick}
        className="absolute top-0 left-0 h-full flex items-center justify-center bg-madael-red text-white touch-none cursor-grab active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-madael-dark disabled:cursor-default"
        style={{
          width: HANDLE_WIDTH,
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : 'transform 200ms ease-out',
        }}
      >
        {running || busy ? <Loader2 size={18} className="animate-spin" /> : <ChevronsRight size={18} />}
      </button>
    </div>
  );
}
