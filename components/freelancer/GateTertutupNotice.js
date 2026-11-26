import Link from 'next/link';

// Penjelasan singkat untuk modul/tab gated yang tertutup (FRE-TOOL-07): `pesan` dari
// evaluasiGate (lib/freelancerGate.js) atau dari API gate, plus tautan ke Profil Saya.
// Hanya tampilan; penegakan ada di server (requireFreelancerModule).
export default function GateTertutupNotice({ pesan, className = '' }) {
  return (
    <div className={`border-l-4 border-amber-500 bg-amber-50 px-3 py-2 ${className}`}>
      <p className="text-xs text-black">{pesan}</p>
      <Link
        href="/employee/freelancer/profil"
        className="inline-block mt-2 text-xs font-medium text-madael-red hover:underline underline-offset-2"
      >
        Buka Profil Saya
      </Link>
    </div>
  );
}
