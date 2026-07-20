'use client';

import { useLanguage } from '@/context/LanguageContext';

const TEXT = {
  id: {
    label: 'Dalam Pengembangan',
    message:
      'Kalkulator ini masih dalam tahap pengembangan. Hasil hitung bisa saja belum 100% akurat — kalau kamu menemukan kesalahan, langsung hubungi kami.',
    cta: 'Hubungi Kami',
  },
  en: {
    label: 'Under Development',
    message:
      "This calculator is still under development. Results may not be 100% accurate yet — if you spot an error, please contact us directly.",
    cta: 'Contact Us',
  },
};

export default function CalculatorDevWarning() {
  const { lang } = useLanguage();
  const t = TEXT[lang] || TEXT.id;

  return (
    <section className="bg-[#FEF3C7] border-b border-[#F5D783] px-10 py-3">
      <div className="max-w-[1100px] mx-auto flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs sm:text-sm text-[#7A5B00] leading-relaxed">
          <span className="font-semibold">{t.label}:</span> {t.message}
        </p>
        <a
          href="https://wa.me/6285121548247?text=Halo%20Madael%20Consult%2C%20saya%20menemukan%20kemungkinan%20kesalahan%20di%20kalkulator."
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs sm:text-sm font-medium text-[#7A5B00] underline underline-offset-2 hover:text-black transition-colors whitespace-nowrap"
        >
          {t.cta}
        </a>
      </div>
    </section>
  );
}
