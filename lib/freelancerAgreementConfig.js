import { cvRefFromDriveId, driveIdFromCvRef } from '@/lib/freelancerAdminConfig';

// Konfigurasi bersama (browser + server) untuk Agreement Freelancer (FRE-TOOL-02).
// Tabel `freelancer_agreements`: satu baris per Freelancer. TIDAK ADA baris =
// "belum tersedia" (Tim belum mengunggah dokumen). Hanya server (service role)
// yang boleh menyentuh tabelnya.
export const AGREEMENT_STATUS = {
  BELUM_TERSEDIA: 'belum_tersedia', // bukan nilai kolom: artinya tidak ada baris
  MENUNGGU_TANDA_TANGAN: 'menunggu_tanda_tangan',
  MENUNGGU_VERIFIKASI: 'menunggu_verifikasi',
  TERVERIFIKASI: 'terverifikasi',
  DITOLAK: 'ditolak',
};

export const AGREEMENT_STATUS_LABEL = {
  [AGREEMENT_STATUS.BELUM_TERSEDIA]: 'Belum tersedia',
  [AGREEMENT_STATUS.MENUNGGU_TANDA_TANGAN]: 'Menunggu tanda tangan',
  [AGREEMENT_STATUS.MENUNGGU_VERIFIKASI]: 'Menunggu verifikasi',
  [AGREEMENT_STATUS.TERVERIFIKASI]: 'Terverifikasi',
  [AGREEMENT_STATUS.DITOLAK]: 'Ditolak',
};

// Segmen URL unduhan -> kolom penunjuk file di tabel.
export const AGREEMENT_DOKUMEN_KOLOM = {
  asli: 'original_doc_ref',
  'bertanda-tangan': 'signed_doc_ref',
};

export const AGREEMENT_ALASAN_MAX = 500;

// Format file Agreement = sama dengan CV (PDF/JPG/PNG). Ini ASUMSI (FRE-Q-16 belum
// dijawab); bila diputuskan lain, ubah di sini dan di periksaAgreement().

// Penunjuk file memakai format yang sama dengan cv_url: "drive:<id file Drive>".
export const agreementRefFromDriveId = cvRefFromDriveId;
export const driveIdFromAgreementRef = driveIdFromCvRef;

// Dokumen asli boleh diunggah/diganti Tim hanya bila belum ada baris, masih menunggu
// tanda tangan, atau ditolak. Setelah terverifikasi tidak boleh berubah. Saat
// menunggu verifikasi juga ditutup supaya dokumen bertanda tangan Freelancer tidak
// terbuang diam-diam: Tim menolaknya lebih dulu, baru mengganti dokumen asli.
export function bolehGantiDokumenAsli(status) {
  return (
    status === AGREEMENT_STATUS.BELUM_TERSEDIA ||
    status === AGREEMENT_STATUS.MENUNGGU_TANDA_TANGAN ||
    status === AGREEMENT_STATUS.DITOLAK
  );
}

// Verifikasi/tolak hanya sah saat Freelancer sudah mengunggah versi bertanda tangan.
export function bolehDiputuskan(status) {
  return status === AGREEMENT_STATUS.MENUNGGU_VERIFIKASI;
}

// Pesan jelas untuk transisi yang tidak sah. Return string, atau null bila sah.
export function pesanTidakBolehGantiAsli(status) {
  if (bolehGantiDokumenAsli(status)) return null;
  if (status === AGREEMENT_STATUS.TERVERIFIKASI) {
    return 'Agreement sudah terverifikasi, sehingga dokumen aslinya tidak dapat diganti.';
  }
  return 'Freelancer sudah mengunggah dokumen bertanda tangan. Verifikasi atau tolak dokumen itu lebih dulu sebelum mengganti dokumen asli.';
}

export function pesanTidakBolehDiputuskan(status) {
  if (bolehDiputuskan(status)) return null;
  if (status === AGREEMENT_STATUS.BELUM_TERSEDIA) {
    return 'Agreement belum tersedia. Unggah dokumen Agreement lebih dulu.';
  }
  if (status === AGREEMENT_STATUS.MENUNGGU_TANDA_TANGAN) {
    return 'Freelancer belum mengunggah dokumen bertanda tangan, jadi belum bisa diverifikasi atau ditolak.';
  }
  return `Agreement sudah ${(AGREEMENT_STATUS_LABEL[status] || status).toLowerCase()}. Hanya Agreement yang menunggu verifikasi yang bisa diputuskan.`;
}

// Validasi body PATCH verifikasi: { keputusan: 'terverifikasi' | 'ditolak', alasan? }.
// Alasan wajib untuk 'ditolak' dan diabaikan untuk 'terverifikasi'.
// Return { error } atau { keputusan, alasan } (alasan = null bila diverifikasi).
export function validateKeputusanAgreement(input) {
  const src = input && typeof input === 'object' ? input : {};
  const keputusan = src.keputusan;
  if (keputusan !== AGREEMENT_STATUS.TERVERIFIKASI && keputusan !== AGREEMENT_STATUS.DITOLAK) {
    return { error: 'Keputusan harus "terverifikasi" atau "ditolak".' };
  }
  if (keputusan === AGREEMENT_STATUS.TERVERIFIKASI) return { keputusan, alasan: null };

  const alasan = typeof src.alasan === 'string' ? src.alasan.trim() : '';
  if (!alasan) return { error: 'Alasan penolakan wajib diisi.' };
  if (alasan.length > AGREEMENT_ALASAN_MAX) {
    return { error: `Alasan penolakan maksimal ${AGREEMENT_ALASAN_MAX} karakter.` };
  }
  return { keputusan, alasan };
}
