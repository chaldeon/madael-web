'use client';

import { useLanguage } from '@/context/LanguageContext';

export default function ContactSection() {
  const { lang } = useLanguage();

  return (
    <section id="contact" className="px-10 py-24 bg-white">
      <h2 className="font-serif text-[32px] font-normal text-black tracking-[-0.02em] leading-[1.2] inline-block border-l-[3px] border-madael-red pl-4 mb-14">
        {lang === 'id' ? 'Hubungi kami' : 'Contact us'}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-12 max-w-[900px]">
        <div>
          <div className="mb-8">
            <div className="text-xs uppercase tracking-[0.1em] text-[#6B6B6B] mb-2">Email</div>
            <div className="text-sm">
              <a
                href="mailto:client.care@madaelconsult.com"
                className="text-black no-underline hover:text-madael-red transition-colors"
              >
                client.care@madaelconsult.com
              </a>
            </div>
          </div>
          <div className="mb-8">
            <div className="text-xs uppercase tracking-[0.1em] text-[#6B6B6B] mb-2">
              {lang === 'id' ? 'Telepon' : 'Phone'}
            </div>
            <div className="text-sm">
              <a
                href="https://wa.me/6285121548247?text=Halo%20Madael%20Consult%2C%20saya%20ingin%20konsultasi%20mengenai%20layanan%20HR%20Anda."
                target="_blank"
                rel="noopener noreferrer"
                className="text-black no-underline hover:text-madael-red transition-colors"
              >
                (+62) 851 2154 8247
              </a>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.1em] text-[#6B6B6B] mb-2">
              {lang === 'id' ? 'Media sosial' : 'Social Media'}
            </div>
            <div className="text-sm">
              <a
                href="https://www.linkedin.com/company/madaelconsult/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-black no-underline hover:text-madael-red transition-colors"
              >
                LinkedIn
              </a>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-8">
            <div className="text-xs uppercase tracking-[0.1em] text-[#6B6B6B] mb-2">
              {lang === 'id' ? 'Kantor administrasi' : 'Administrative Office'}
            </div>
            <div className="text-sm">
              <strong className="text-black">Hive Five Kelapa Gading</strong>
              <br />
              <span  className="block pl-3 text-[#3D3D3D]">
                Jl. Gading Kirana Timur A-11/15
                <br />
                Jakarta Utara 14240
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.1em] text-[#6B6B6B] mb-2">
              {lang === 'id' ? 'Kantor operasional' : 'Operational Office'}
            </div>
            <div className="text-sm">
              <strong className="text-black">Metland Menteng</strong>
              <br />
              <span  className="block pl-3 text-[#3D3D3D]">
                Ujung Menteng,Jakarta Timur 13960
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
