import { Info } from 'lucide-react';

// Catatan pedoman rekrutmen (FRE-TOOL-18): agama dan hal SARA tidak boleh
// dicantumkan atau dicatat. Boleh ditanyakan secara informal saat interview,
// tetapi tidak dicatat (meeting 13 November 2026, [01:24:40]–[01:26:24]).
//
// SENGAJA hanya memuat aturan agama/SARA yang sudah jelas. Usia dan merokok belum
// diputuskan (FRE-Q-14), jadi tidak disebut di sini; bila diputuskan, tambahkan
// di POKOK saja supaya semua tempat pemakaian ikut berubah.
//
// Teks saja: tidak memblokir atau memvalidasi isi apa pun (mengubah aturan
// pertanyaan custom di luar lingkup).
//
// konteks:
//   'pertanyaan' = di editor pertanyaan lowongan (apa yang boleh dicantumkan)
//   'catatan'    = di tempat menulis catatan pelamar (apa yang boleh dicatat)
const POKOK = 'Pedoman rekrutmen: agama dan hal SARA (suku, agama, ras, antargolongan) tidak boleh dicantumkan atau dicatat.';

const LANJUTAN = {
  pertanyaan:
    'Jangan membuat pertanyaan tentang hal tersebut di sini. Boleh ditanyakan secara informal saat interview, tetapi tidak dicatat.',
  catatan: 'Boleh ditanyakan secara informal saat interview, tetapi jangan dicatat di sini.',
};

export default function PedomanRekrutmenNote({ konteks = 'catatan', className = '' }) {
  return (
    <div className={`flex items-start gap-2 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 ${className}`}>
      <Info size={14} className="text-amber-700 shrink-0 mt-0.5" />
      <p className="text-xs text-black">
        {POKOK} {LANJUTAN[konteks] || LANJUTAN.catatan}
      </p>
    </div>
  );
}
