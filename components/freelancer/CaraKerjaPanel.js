// Panel "Cara kerja" singkat untuk Freelancer (FRE-TOOL-18). Isinya alur kerja
// menurut SOP Freelance Recruitment (Tahap A–D) dan meeting 13 November 2026;
// batas peran: Freelancer selesai di Candidate Profile, interview dan offering
// ditangani Tim Internal (diputuskan 18 November 2026).
//
// Hanya menjelaskan LANGKAH, bukan menjanjikan fitur. Catatan di bawah daftar
// sengaja netral supaya tidak menjadi usang saat menu dibuka satu per satu.
// Tambah/ubah langkah hanya bila SOP berubah; jangan menulis langkah untuk fitur
// yang belum ada di SOP.
const LANGKAH = [
  {
    judul: 'Lengkapi profil dan Agreement',
    isi: 'Isi data pembayaran di halaman ini, lalu tandatangani dan unggah Agreement. Tim Internal akan memverifikasinya.',
  },
  {
    judul: 'Buka Job Ad',
    isi: 'Setelah profil lengkap dan Agreement terverifikasi, kamu dapat melihat Job Ad yang sedang aktif.',
  },
  {
    judul: 'Bagikan link referral',
    isi: 'Bagikan link Job Ad yang memuat kode referral kamu kepada kandidat, supaya lamaran mereka tercatat sebagai kandidat kamu.',
  },
  {
    judul: 'Pantau Pelamar Saya',
    isi: 'Lihat kandidat yang melamar lewat link referral kamu. Statusnya hanya dapat dilihat, bukan diubah.',
  },
  {
    judul: 'Susun Candidate Profile',
    isi: 'Untuk kandidat yang lolos pemeriksaan CV, susun Candidate Profile dan serahkan ke Tim Internal. Interview dan offering ditangani Tim Internal.',
  },
];

export default function CaraKerjaPanel({ className = '' }) {
  return (
    <div className={`bg-white border border-[#E0E0E0] p-6 ${className}`}>
      <h2 className="text-sm font-medium text-black mb-3">Cara Kerja Freelancer</h2>
      <ol className="space-y-3">
        {LANGKAH.map((langkah, index) => (
          <li key={langkah.judul} className="flex items-start gap-3">
            <span className="w-6 h-6 shrink-0 flex items-center justify-center bg-madael-red text-white text-xs font-medium">
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-medium text-black">{langkah.judul}</p>
              <p className="text-sm text-[#6B6B6B]">{langkah.isi}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-[#9A9A9A] mt-4">
        Langkah yang menunya belum aktif di dashboard belum bisa dipakai saat ini.
      </p>
    </div>
  );
}
