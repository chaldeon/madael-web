import Image from 'next/image';

export default function Footer() {
  return (
    <footer className="flex items-center justify-between flex-wrap gap-4 px-10 py-8 border-t border-[#E0E0E0]">
      <div className="flex items-center gap-2.5">
        <Image
          src="/logos/madael_logo_transparent.png"
          alt="Madael Consult"
          width={28}
          height={28}
          className="object-contain"
        />
        <span className="text-[13px] text-[#777] tracking-[0.06em]">
          MADAEL CONSULT
        </span>
      </div>

      <div className="flex items-center gap-6 flex-wrap">
        <a
          href="https://wa.me/6285121548247?text=Halo%20Madael%20Consult%2C%20saya%20ingin%20konsultasi%20mengenai%20layanan%20HR%20Anda."
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[#555] tracking-[0.06em] no-underline hover:text-[#999] transition-colors"
        >
          Whatsapp
        </a>
        <a
          href="https://www.linkedin.com/company/madaelconsult/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[#555] tracking-[0.06em] no-underline hover:text-[#999] transition-colors"
        >
          LinkedIn
        </a>
        <a
          href="mailto:client.care@madaelconsult.com"
          className="text-xs text-[#555] tracking-[0.06em] no-underline hover:text-[#999] transition-colors"
        >
          client.care@madaelconsult.com
        </a>
        <span className="text-xs text-[#333]">
          © 2026 PT Madael Prima Sejahtera Indonesia
        </span>
      </div>
    </footer>
  );
}
