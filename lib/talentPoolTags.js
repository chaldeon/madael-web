// Tag manual untuk kandidat di talent pool (lamaran umum, job_id null).
// Dipakai bersama oleh halaman pelamar (client) dan route /api/applications/[id]/tags
// (server), supaya aturan normalisasinya selalu sama.

export const MAX_TAG_LENGTH = 30;
export const MAX_TAGS_PER_CANDIDATE = 10;

// Satu tag: tanpa karakter kontrol & koma, spasi dirapikan, huruf kecil semua
// ("Excel" dan "excel" dianggap tag yang sama), dipotong ke MAX_TAG_LENGTH.
export function normalizeTag(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_TAG_LENGTH)
    .trim();
}

// Daftar tag dari array ATAU teks dipisah koma ("excel, sales"), unik, urutan terjaga.
export function parseTagList(input) {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(',');
  const seen = new Set();
  const result = [];
  for (const part of parts) {
    const tag = normalizeTag(part);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
  }
  return result;
}

// Nilai kolom `tags` dari database -> array tag bersih (aman untuk null / data aneh).
export function normalizeTags(value) {
  return Array.isArray(value) ? parseTagList(value) : [];
}
