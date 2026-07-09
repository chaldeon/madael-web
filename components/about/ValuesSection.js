'use client';

import { Shield, Scale, HeartHandshake, Award, Coins } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

const values = [
  { Icon: Shield, en: 'Safety' },
  { Icon: Scale, en: 'Integrity' },
  { Icon: HeartHandshake, en: 'Respect' },
  { Icon: Award, en: 'Quality' },
  { Icon: Coins, en: 'Cost' },
];

export default function ValuesSection() {
  const { lang } = useLanguage();

  return (
    <section className="px-10 py-20 bg-[#F4F4F4] border-t border-[#E0E0E0]">
      <div className="text-center">
        <h2 className="font-serif text-[32px] font-normal text-black tracking-[-0.02em] leading-[1.2] inline-block border-l-[3px] border-madael-red pl-4 mb-10">
          {lang === 'id' ? 'Nilai-nilai Kami' : 'Our Values'}
        </h2>
      </div>

      <div className="flex border border-[#E0E0E0] max-w-[900px] mx-auto">
        {values.map(({ Icon, id, en }, i) => (
          <div
            key={en}
            className={`group flex-1 py-8 px-6 text-center bg-white transition-colors duration-200 hover:bg-madael-red ${
              i !== values.length - 1 ? 'border-r border-[#E0E0E0]' : ''
            }`}
          >
            <div className="w-[45px] h-[45px] border border-[#E0E0E0] flex items-center justify-center mx-auto mb-3 transition-colors duration-200 group-hover:border-white/30">
              <Icon
                size={26}
                strokeWidth={1.75}
                className="text-[#6B6B6B] transition-colors duration-200 group-hover:text-white/70"
              />
            </div>
            <div className="text-[20px] font-semibold text-black tracking-[0.06em] uppercase transition-colors duration-200 group-hover:text-white">
              {en}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}