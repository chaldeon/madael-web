// Status pelamar + alasan penolakan. Dipakai bersama oleh halaman Pelamar
// (client) dan route /api/applications/[id]/status (server), supaya daftar
// status dan aturan normalisasi alasan selalu sama.

export const APPLICATION_STATUSES = ['Baru', 'Review', 'Interview', 'Ditolak', 'Diterima'];

export const MAX_REASON_LENGTH = 300;

export const REJECTION_REASON_OTHER = 'Lainnya';
export const REJECTION_REASON_PRESETS = [
  'Kualifikasi tidak sesuai',
  'Pengalaman belum cukup',
  'Tidak lolos interview',
  'Ekspektasi gaji tidak sesuai',
  'Kandidat mengundurkan diri',
  'Posisi sudah terisi',
  REJECTION_REASON_OTHER,
];

// Teks alasan: tanpa karakter kontrol, spasi dirapikan, dipotong ke MAX_REASON_LENGTH.
export function normalizeReason(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_REASON_LENGTH)
    .trim();
}

// Gabungkan pilihan alasan + keterangan tambahan jadi satu teks. Return null
// kalau belum valid (pilihan di luar daftar, atau "Lainnya" tanpa keterangan).
export function buildRejectionReason(preset, detail) {
  const p = String(preset ?? '').trim();
  if (!REJECTION_REASON_PRESETS.includes(p)) return null;
  const d = normalizeReason(detail);
  if (p === REJECTION_REASON_OTHER) return d || null;
  return normalizeReason(d ? `${p}: ${d}` : p);
}
