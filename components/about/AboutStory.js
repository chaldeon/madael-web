'use client';

import Image from 'next/image';
import { useLanguage } from '@/context/LanguageContext';

const journeyItems = [
  {
    year: '2016',
    id: 'Mangara Sidabutar memulai praktik konsultansi HR secara independen, berfokus pada Industrial Relations dan kepatuhan ketenagakerjaan.',
    en: 'Mangara Sidabutar began an independent HR consulting practice, focusing on Industrial Relations and labor compliance.',
    dark: false,
  },
  {
    year: '2018',
    id: (
      <>Bisnis resmi berbadan hukum sebagai <strong>PT Madael Prima Sejahtera Indonesia</strong>, memperluas layanan ke rekrutmen, outsourcing, dan legal compliance.</>
    ),
    en: (
      <>The business was formally incorporated as <strong>PT Madael Prima Sejahtera Indonesia</strong>, expanding services into recruitment, outsourcing, and legal compliance.</>
    ),
    dark: false,
  },
  {
    year: '2020 — 2023',
    id: "Melewati masa pandemi dengan tetap melayani klien secara konsisten, mengadaptasi layanan ke kebutuhan baru perusahaan di tengah perubahan regulasi ketenagakerjaan.",
    en: "Navigated the pandemic while consistently serving clients, adapting services to companies' evolving needs amid shifting labor regulations.",
    dark: false,
  },
  {
    year: '2024 — Sekarang',
    id: 'Terus bertumbuh melayani klien lokal dan multinasional di berbagai sektor industri di seluruh Indonesia.',
    en: 'Continuing to grow, serving local and multinational clients across various industries throughout Indonesia.',
    dark: true,
  },
];

export default function AboutStory() {
  const { lang } = useLanguage();

  return (
    <section className="px-10 py-24 bg-white border-b border-[#E0E0E0]">
      <div className="max-w-[1100px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-20 items-start">

        {/* Journey */}
        <div>
          <h2 className="font-serif text-[32px] font-normal text-black tracking-[-0.02em] leading-[1.2] inline-block border-l-[3px] border-madael-red pl-4 mb-10">
            {lang === 'id' ? 'Perjalanan kami' : 'Our journey'}
          </h2>

          <div className="flex flex-col">
            {journeyItems.map((item, i) => (
              <div key={item.year} className="flex gap-5">
                <div className="flex flex-col items-center w-2 flex-shrink-0">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${
                      item.dark ? 'bg-black' : 'bg-madael-red'
                    }`}
                  />
                  {i !== journeyItems.length - 1 && (
                    <span className="flex-1 w-px bg-[#E0E0E0] mt-1" />
                  )}
                </div>
                <div className="pb-8">
                  <div
                    className={`text-[11px] tracking-[0.1em] font-semibold mb-1 ${
                      item.dark ? 'text-black' : 'text-madael-red'
                    }`}
                  >
                    {item.year}
                  </div>
                  <div className="text-sm text-[#3D3D3D] leading-[1.65]">
                    {lang === 'id' ? item.id : item.en}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Founder */}
        <div>
          <h2 className="font-serif text-[32px] font-normal text-black tracking-[-0.02em] leading-[1.2] inline-block border-l-[3px] border-madael-red pl-4 mb-10">
            {lang === 'id' ? 'Pendiri' : 'Founder'}
          </h2>

          <div className="border border-[#E0E0E0] p-10 bg-white">
            <Image
              src="/logos/founder.jpg"
              alt="Mangara Sidabutar"
              width={140}
              height={140}
              className="object-cover bg-[#F4F4F4] border border-[#E0E0E0] mb-6"
            />
            <div className="font-serif text-[22px] font-normal text-black tracking-[-0.01em] mb-1">
              Mangara Sidabutar
            </div>
            <div className="text-xs tracking-[0.1em] uppercase text-madael-red font-semibold mb-5">
              Founder & Senior Consultant
            </div>
            <div className="text-sm text-[#6B6B6B] leading-[1.75] border-t border-[#E0E0E0] pt-5">
              {lang === 'id'
                ? 'Dengan pengalaman lebih dari satu dekade di bidang HR, Mangara Sidabutar memiliki keahlian mendalam dalam Industrial Relations, HR Strategy, dan Corporate Legal Compliance. Beliau telah membantu puluhan perusahaan lokal dan multinasional beroperasi sesuai regulasi ketenagakerjaan Indonesia.'
                : 'With over a decade of experience in HR, Mangara Sidabutar has deep expertise in Industrial Relations, HR Strategy, and Corporate Legal Compliance. He has helped dozens of local and multinational companies operate in compliance with Indonesian labor regulations.'}
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}