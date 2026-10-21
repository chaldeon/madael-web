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
