import { statusKontrak } from '@/lib/kepegawaian';

// Lencana status kontrak. Tidak menampilkan apa pun kalau tidak ada tanggal
// berakhir (PKWTT / belum diisi). Warna: merah = sudah berakhir, kuning =
// segera berakhir, hijau = masih aman.
const STYLE = {
  berakhir: 'bg-red-50 text-red-700',
  segera: 'bg-amber-50 text-amber-800',
  aman: 'bg-[#DCFCE7] text-[#166534]',
};

export default function KontrakBadge({ kontrakBerakhir, today }) {
  const status = statusKontrak(kontrakBerakhir, today);
  if (status.kind === 'none') return null;
  return (
    <span className={`inline-block text-xs font-medium px-2.5 py-1 whitespace-nowrap ${STYLE[status.kind]}`}>
      {status.label}
    </span>
  );
}
