'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

const HERO_PHOTOS = Array.from({ length: 8 }, (_, i) => `/logos/hero%20${i + 1}.jpg`);

function AnimatedStat({ target, labelId, labelEn }) {
  const { lang } = useLanguage();
  const [value, setValue] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !started) {
            setStarted(true);
            const duration = 2000;
            const startTime = performance.now();

            const step = (now) => {
              const progress = Math.min((now - startTime) / duration, 1);
              const eased = 1 - Math.pow(1 - progress, 3);
              setValue(Math.round(eased * target));
              if (progress < 1) requestAnimationFrame(step);
              else setValue(target);
            };
            requestAnimationFrame(step);
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [started, target]);

  return (
    <div ref={ref} className="text-right">
      <div className="font-serif text-[42px] text-white font-normal leading-none">
        {value}+
      </div>
      <div className="text-[17px] text-[#666] tracking-[0.08em] uppercase mt-1">
        {lang === 'id' ? labelId : labelEn}
      </div>
    </div>
  );
}

export default function HeroSection() {
  const { lang } = useLanguage();
  const [bgIndex, setBgIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setBgIndex((i) => (i + 1) % HERO_PHOTOS.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="min-h-[520px] bg-black flex items-center relative overflow-hidden px-10 py-6">
      <div
        className="absolute inset-0 bg-cover bg-center transition-[background-image] duration-300 ease-in-out"
        style={{ backgroundImage: `url('${HERO_PHOTOS[bgIndex]}')` }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(135deg, rgba(26,10,11,0.86) 0%, rgba(17,17,17,0.82) 50%, rgba(13,26,46,0.86) 100%)',
        }}
      />
      <div className="absolute top-0 left-0 w-1 h-full bg-madael-red z-[1]" />

      <div className="relative max-w-[680px] z-[1]">
        <div className="text-[11px] tracking-[0.18em] uppercase text-madael-red font-semibold mb-6 flex items-center gap-3">
          <span className="block w-6 h-px bg-madael-red" />
          HR & Legal Consulting — Indonesia
        </div>
        <h1 className="font-serif text-[clamp(36px,5vw,58px)] font-normal leading-[1.12] text-white tracking-[-0.02em] mb-6">
          Your Trusted
          <br />
          HR & Legal <em className="text-madael-red italic">Partner</em>
          <br />
          in Indonesia
        </h1>
        <p className="text-base leading-[1.7] text-[#AAA] max-w-[480px] mb-10">
          {lang === 'id'
            ? 'Kami membantu perusahaan lokal dan asing mengelola SDM, kepatuhan hukum, dan operasional HR secara efektif di Indonesia.'
            : 'We help local and foreign companies manage HR, legal compliance, and workforce operations effectively in Indonesia.'}
        </p>
        <div className="flex gap-4 items-center flex-wrap">
          <a
            href="#contact"
            className="bg-madael-red text-white px-7 py-3.5 text-sm font-medium tracking-[0.04em] no-underline hover:bg-madael-dark transition-colors inline-block"
          >
            {lang === 'id' ? 'Hubungi Kami →' : 'Contact Us →'}
          </a>
          <a
            href="/about"
            className="text-[#888] text-[13px] no-underline flex items-center gap-1.5 hover:text-white transition-colors"
          >
            {lang === 'id' ? 'Tentang Kami ↓' : 'About Us ↓'}
          </a>
        </div>
      </div>

      <div className="absolute bottom-10 right-10 flex gap-10 z-[1]">
        <AnimatedStat target={10} labelId="Tahun pengalaman" labelEn="Years of experience" />
        <AnimatedStat target={20} labelId="Klien dilayani" labelEn="Clients served" />
      </div>
    </section>
  );
}
