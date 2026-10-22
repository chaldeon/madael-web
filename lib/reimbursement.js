// Aturan status klaim reimbursement — dipakai rute API (penegakan) dan halaman
// admin. Satu sumber supaya transisi yang sah tidak tersebar di banyak tempat.

// Aksi dari body request -> status tujuan di tabel reimbursement_requests.
export const REIMBURSEMENT_ACTION_TARGET = {
  approve: 'approved',
  reject: 'rejected',
  pay: 'paid',
};

// Label status untuk tampilan (halaman karyawan, halaman admin, pesan 409).
export const STATUS_REIMBURSEMENT_LABEL = {
  pending: 'MENUNGGU',
  approved: 'DISETUJUI',
  rejected: 'DITOLAK',
  paid: 'SUDAH DIBAYAR',
  cancelled: 'DIBATALKAN',
};

// Transisi yang sah: status sekarang -> status tujuan yang boleh. 'rejected',
// 'paid', dan 'cancelled' sengaja tanpa jalan keluar (klaim selesai); koreksi
// harus lewat klaim baru, bukan mengubah klaim yang sudah final.
// 'cancelled' hanya dicapai lewat POST /api/reimbursement/[id]/cancel oleh
// pemilik klaim (bukan lewat REIMBURSEMENT_ACTION_TARGET, jadi admin tidak
// bisa memicunya dari rute status).
export const REIMBURSEMENT_TRANSITIONS = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['paid'],
};

export function canTransitionReimbursement(from, to) {
  return (REIMBURSEMENT_TRANSITIONS[from] || []).includes(to);
}

// Pesan 409 untuk transisi yang tidak sah, dibedakan per aksi supaya jelas
// apa syarat status-nya.
export function pesanTransisiTidakValid(action) {
  if (action === 'pay') {
    return 'Hanya klaim yang sudah disetujui yang bisa ditandai dibayar. Daftar dimuat ulang.';
  }
  return 'Klaim ini sudah tidak berstatus menunggu (sudah diproses). Daftar dimuat ulang.';
}

// Batas panjang teks bebas (alasan penolakan / catatan dibayar) yang diterima
// server. Hanya pagar terhadap input berlebihan; dialog di halaman admin
// tidak membatasinya.
export const MAX_REIMBURSEMENT_TEXT_LENGTH = 1000;

// Teks opsional dari body: bukan string / kosong -> null. Baris baru
// dipertahankan (tidak diratakan seperti alasan penolakan pelamar).
export function normalizeReimbursementText(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().slice(0, MAX_REIMBURSEMENT_TEXT_LENGTH).trim();
  return text || null;
}

// ── Pengajuan klaim (POST /api/reimbursement) ─────────────────────────────
// Dipakai route (penegakan) dan halaman karyawan (opsi form + pesan awal),
// supaya aturan tidak tersebar di dua tempat.

export const KATEGORI_REIMBURSEMENT = [
  { value: 'transport', label: 'Transport' },
  { value: 'kesehatan', label: 'Kesehatan' },
  { value: 'lainnya', label: 'Lainnya' },
];

// Plafon per KLAIM (Rp) untuk tiap kategori. Klaim di atas plafon ditolak
// server dan harus dipecah / diajukan lewat HR.
// CATATAN: angka ini asumsi awal, BELUM ditetapkan kebijakan perusahaan —
// sesuaikan dengan kebijakan reimbursement Madael sebelum dipakai produksi.
export const PLAFON_KLAIM_REIMBURSEMENT = {
  transport: 1_000_000,
  kesehatan: 5_000_000,
  lainnya: 2_000_000,
};

export function kategoriReimbursementValid(kategori) {
  return KATEGORI_REIMBURSEMENT.some((k) => k.value === kategori);
}

export function labelKategoriReimbursement(kategori) {
  return KATEGORI_REIMBURSEMENT.find((k) => k.value === kategori)?.label || kategori;
}

export const MAKS_DESKRIPSI_REIMBURSEMENT = 500;

// Format bukti yang diterima (nilai = ekstensi untuk nama file di storage).
export const BUKTI_REIMBURSEMENT_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

// Status klaim yang MEMBLOKIR pengajuan ulang dengan bukti yang sama. Klaim
// yang ditolak/dibatalkan tidak memblokir: karyawan boleh memperbaiki dan
// mengajukan lagi dengan kuitansi yang sama.
export const STATUS_BLOKIR_BUKTI_GANDA = ['pending', 'approved', 'paid'];

// Validasi field teks/angka klaim. Return { error } atau { kategori, jumlah,
// deskripsi } yang sudah dinormalisasi. `jumlah` boleh string digit atau angka.
export function validasiKlaimReimbursement({ kategori, jumlah, deskripsi }) {
  if (!kategoriReimbursementValid(kategori)) {
    return { error: 'Kategori klaim tidak valid.' };
  }

  const teksJumlah = typeof jumlah === 'number' ? String(jumlah) : jumlah;
  if (typeof teksJumlah !== 'string' || !/^\d{1,12}$/.test(teksJumlah.trim())) {
    return { error: 'Jumlah klaim harus berupa angka rupiah bulat (tanpa desimal).' };
  }
  const nominal = Number(teksJumlah.trim());
  if (!Number.isSafeInteger(nominal) || nominal <= 0) {
    return { error: 'Jumlah klaim wajib diisi dan lebih dari 0.' };
  }
  const plafon = PLAFON_KLAIM_REIMBURSEMENT[kategori];
  if (nominal > plafon) {
    return {
      error: `Jumlah klaim ${labelKategoriReimbursement(kategori)} melebihi plafon per klaim (Rp ${plafon.toLocaleString('id-ID')}). Hubungi HR untuk klaim di atas plafon.`,
    };
  }

  const teksDeskripsi = typeof deskripsi === 'string' ? deskripsi.trim() : '';
  if (!teksDeskripsi) {
    return { error: 'Deskripsi klaim wajib diisi.' };
  }
  if (teksDeskripsi.length > MAKS_DESKRIPSI_REIMBURSEMENT) {
    return { error: `Deskripsi maksimal ${MAKS_DESKRIPSI_REIMBURSEMENT} karakter.` };
  }

  return { kategori, jumlah: nominal, deskripsi: teksDeskripsi };
}
