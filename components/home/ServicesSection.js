'use client';

import { useLanguage } from '@/context/LanguageContext';

const SERVICES = [
  {
    num: '01',
    name: 'Talent Acquisition',
    descId: 'Headhunting, rekrutmen massal, dan penempatan kerja untuk semua level.',
    descEn: 'Headhunting, mass recruitment, and job placement for all levels.',
  },
  {
    num: '02',
    name: 'Outsourcing / EOR',
    descId: 'Employer of Record dan manajemen tenaga alih daya sesuai regulasi Indonesia.',
    descEn: 'Employer of Record and outsourced workforce management compliant with Indonesian regulations.',
  },
  {
    num: '03',
    name: 'Payroll Management',
    descId: 'Pengelolaan penggajian bulanan, slip gaji, dan pelaporan pajak karyawan.',
    descEn: 'Monthly payroll processing, payslips, and employee tax reporting.',
  },
  {
    num: '04',
    name: 'HR Consultation',
    descId: 'Strategi SDM, struktur organisasi, dan pengembangan sistem HR perusahaan.',
    descEn: 'HR strategy, organizational structure, and corporate HR system development.',
  },
  {
    num: '05',
    name: 'Corporate Legal',
    descId: 'RUPS, akta pendirian, legal opinion, dan kepatuhan hukum perusahaan.',
    descEn: 'GMS, deed of establishment, legal opinions, and corporate legal compliance.',
  },
  {
    num: '06',
    name: 'Expatriate Management',
    descId: 'RPTKA, izin tinggal, imigrasi, dan administrasi tenaga kerja asing.',
    descEn: 'RPTKA, stay permits, immigration, and foreign worker administration.',
  },
  {
    num: '07',
    name: 'Industrial Relations',
    descId: 'PK, PP, PKB, mediasi, terminasi, dan hubungan bipartit perusahaan.',
    descEn: 'Employment agreements, company regulations, CBAs, mediation, termination, and company bipartite relations.',
  },
  {
    num: '08',
    name: 'License to Operate',
    descId: 'SIUP, TDP, IUP, IUJP, dan pengurusan izin operasional bisnis.',
    descEn: 'Business licenses (SIUP, TDP, IUP, IUJP) and operational permit processing.',
  },
];

function waHref(serviceName) {
  const msg = `Halo Madael Consult, saya ingin konsultasi gratis mengenai layanan ${serviceName}.`;
  return `https://wa.me/6285121548247?text=${encodeURIComponent(msg)}`;
}

export default function ServicesSection() {
  const { lang } = useLanguage();

  return (
    <section className="px-10 py-24 bg-white">
      <div className="flex items-end justify-between mb-14 border-b border-[#E0E0E0] pb-6">
        <div className="font-serif text-[32px] font-normal text-black tracking-[-0.02em] leading-[1.2] inline-block border-l-[3px] border-madael-red pl-4">
          {lang === 'id' ? 'What We Do' : 'Our services'}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-t border-l border-[#E0E0E0]">
        {SERVICES.map((s) => (
          <div
            key={s.num}
            className="group border-r border-b border-[#E0E0E0] p-10 transition-colors hover:bg-[#F4F4F4]"
          >
            <div className="text-madael-red text-xs font-semibold tracking-[0.1em] mb-3">
              {s.num}
            </div>
            <div className="text-[20px] font-semibold text-black mb-2">{s.name}</div>
            <div className="text-[15px] text-[#6B6B6B] leading-[1.6]">
              {lang === 'id' ? s.descId : s.descEn}
            </div>
            <a
              href={waHref(s.name)}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-madael-red text-[13px] font-medium no-underline hover:text-black transition-all max-h-0 opacity-0 group-hover:max-h-8 group-hover:opacity-100 group-hover:mt-4 overflow-hidden"
            >
              {lang === 'id' ? 'Konsultasi Gratis → ' : 'Free Consultation → '}
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
