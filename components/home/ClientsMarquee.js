'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

const CLIENTS = [
  { file: 'client-1.png', alt: 'APINDO' },
  { file: 'client-2.png', alt: 'SPEEE' },
  { file: 'client-3.png', alt: 'SODEXO' },
  { file: 'client-4.png', alt: 'MERDEKA COPPER GOLD' },
  { file: 'client-5.png', alt: 'AHLERS' },
  { file: 'client-6.png', alt: 'ORICA' },
  { file: 'client-7.png', alt: 'KOTA BONTANG' },
  { file: 'client-8.png', alt: 'LUWU TIMUR' },
  { file: 'client-9.png', alt: 'MORULA IVF' },
  { file: 'client-10.png', alt: 'PHILIPS' },
  { file: 'client-11.png', alt: 'NEXIA' },
  { file: 'client-12.png', alt: 'XYLEM' },
];

// duplicated for a seamless loop
const TRACK = [...CLIENTS, ...CLIENTS];

const SPEED = 0.5; // px per frame
const RESUME_DELAY = 500; // ms

export default function ClientsMarquee() {
  const { lang } = useLanguage();
  const wrapRef = useRef(null);
  const trackRef = useRef(null);
  const stateRef = useRef({ hovering: false, dragging: false, resumeTimer: null, startX: 0, startScroll: 0 });

  useEffect(() => {
    const wrap = wrapRef.current;
    const track = trackRef.current;
    if (!wrap || !track) return;
    const st = stateRef.current;
    let rafId;

    const isPaused = () => st.hovering || st.dragging || st.resumeTimer !== null;

    const clearResumeTimer = () => {
      if (st.resumeTimer) {
        clearTimeout(st.resumeTimer);
        st.resumeTimer = null;
      }
    };

    const scheduleResume = () => {
      clearResumeTimer();
      st.resumeTimer = setTimeout(() => {
        st.resumeTimer = null;
      }, RESUME_DELAY);
    };

    const wrapScroll = () => {
      const half = track.scrollWidth / 2;
      if (wrap.scrollLeft >= half) wrap.scrollLeft -= half;
      else if (wrap.scrollLeft < 0) wrap.scrollLeft += half;
    };

    const tick = () => {
      if (!isPaused()) {
        wrap.scrollLeft -= SPEED;
        const half = track.scrollWidth / 2;
        if (wrap.scrollLeft <= 0) wrap.scrollLeft += half;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const onPointerEnter = () => {
      st.hovering = true;
      clearResumeTimer();
    };
    const onPointerLeave = () => {
      st.hovering = false;
      if (!st.dragging) scheduleResume();
    };
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        wrap.scrollLeft += e.deltaY;
        e.preventDefault();
      }
      wrapScroll();
      if (!st.hovering) scheduleResume();
    };
    const onPointerDown = (e) => {
      st.dragging = true;
      wrap.classList.add('cursor-grabbing');
      st.startX = e.pageX;
      st.startScroll = wrap.scrollLeft;
      clearResumeTimer();
    };
    const onPointerMove = (e) => {
      if (!st.dragging) return;
      wrap.scrollLeft = st.startScroll - (e.pageX - st.startX);
      wrapScroll();
    };
    const onPointerUp = () => {
      st.dragging = false;
      wrap.classList.remove('cursor-grabbing');
      if (!st.hovering) scheduleResume();
    };

    wrap.addEventListener('pointerenter', onPointerEnter);
    wrap.addEventListener('pointerleave', onPointerLeave);
    wrap.addEventListener('wheel', onWheel, { passive: false });
    wrap.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      cancelAnimationFrame(rafId);
      clearResumeTimer();
      wrap.removeEventListener('pointerenter', onPointerEnter);
      wrap.removeEventListener('pointerleave', onPointerLeave);
      wrap.removeEventListener('wheel', onWheel);
      wrap.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  return (
    <section className="px-10 py-20 bg-[#F4F4F4] border-t border-b border-[#E0E0E0]">
      <div className="text-center mb-12">
        <div className="text-[11px] tracking-[0.14em] uppercase text-[#6B6B6B] font-semibold">
          {lang === 'id' ? 'Dipercaya oleh' : 'Trusted by'}
        </div>
      </div>

      <div
        ref={wrapRef}
        className="overflow-x-auto overflow-y-hidden max-w-[1100px] mx-auto border-t border-b border-[#E0E0E0] cursor-grab [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [-webkit-mask-image:linear-gradient(to_right,transparent,#000_6%,#000_94%,transparent)] [mask-image:linear-gradient(to_right,transparent,#000_6%,#000_94%,transparent)] [&::-webkit-scrollbar]:hidden"
      >
        <div ref={trackRef} className="flex w-max">
          {TRACK.map((c, i) => (
            <div
              key={`${c.file}-${i}`}
              className="bg-white flex-none w-40 h-20 flex items-center justify-center overflow-hidden p-3 border-r border-[#E0E0E0] group"
            >
              <img
                src={`/logos/${c.file}`}
                alt={c.alt}
                draggable={false}
                className="max-w-full max-h-full w-auto h-auto object-contain grayscale opacity-55 group-hover:grayscale-0 group-hover:opacity-100 transition-[filter,opacity] duration-200 select-none pointer-events-none"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
