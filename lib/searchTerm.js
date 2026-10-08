// Sanitasi input pencarian sebelum disisipkan ke filter PostgREST.
//
// Masalahnya: istilah pencarian disisipkan mentah ke string `.or()` seperti
// `nama.ilike.%${q}%,employee_id.ilike.%${q}%`. Di sintaks filter PostgREST,
// koma memisahkan kondisi dan kurung membuka/menutup grup, jadi input seperti
// "Budi, S" atau "a)b" memecah filter (kondisi tambahan bisa tersisip, atau
// query error). `"` dan `\` adalah karakter kutip/escape, sedangkan `*`, `%`,
// dan `_` bekerja sebagai wildcard pada ilike.
//
// Karakter-karakter itu diganti SPASI (bukan dibuang rapat) lalu spasi
// dirapikan: "Budi,Santoso" jadi "Budi Santoso" (masih bisa cocok dengan nama),
// bukan "BudiSantoso". Tanda yang umum di nomor surat ("/", "-", ".") tidak
// disentuh.
//
// Catatan: karena `_` dan `%` tidak lagi dipakai, pencarian tidak bisa cocok
// literal dengan "_" (mis. email "john_doe@..."); cari bagian sebelum/sesudahnya.

export const MAX_SEARCH_LENGTH = 80;

// Karakter struktural filter PostgREST + wildcard ilike, dan karakter kontrol
// (C0, DEL, C1). Karakter kontrol yang berupa whitespace (tab/baris baru) ikut
// jadi spasi.
const UNSAFE_CHARS = /[,()"\\*%_\u0000-\u001F\u007F-\u009F]/g;

// Kembalikan istilah pencarian yang aman, atau '' kalau tidak ada isi.
// Fungsi murni; null/undefined/non-string ditangani.
export function sanitizeSearchTerm(input) {
  if (input === null || input === undefined) return '';

  const cleaned = String(input)
    .replace(UNSAFE_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Potong per code point (bukan per code unit) supaya pasangan surrogate
  // seperti emoji tidak terbelah di batas panjang.
  const chars = Array.from(cleaned);
  if (chars.length <= MAX_SEARCH_LENGTH) return cleaned;
  return chars.slice(0, MAX_SEARCH_LENGTH).join('').trimEnd();
}
