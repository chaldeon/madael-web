// Helper waktu WIB (Asia/Jakarta, UTC+7, tanpa DST) untuk sisi client.
//
// Server (lib/serverTime.js) selalu menghitung tanggal/jam absensi dalam WIB.
// Layar client yang memakai jam perangkat (new Date().getDate(), getHours(),
// dst) akan bergeser dari data server bila perangkat berada di WITA/WIT atau
// di luar negeri. Semua "hari ini", "kemarin", hari kerja, dan jam input
// manual di layar absensi harus lewat helper ini.
//
// Fungsi tanggal/jam dasar dipakai ulang dari lib/serverTime.js (murni Intl,
// aman juga di browser) supaya client dan server tidak punya dua implementasi.

import { todayJakarta, jamJakarta } from '@/lib/serverTime';

// Offset tetap WIB. Indonesia tidak memakai DST.
const WIB_OFFSET = '+07:00';

// 'YYYY-MM-DD' di WIB untuk instant `date` (default: sekarang).
export function todayWib(date = new Date()) {
  return todayJakarta(date);
}

// 'YYYY-MM-DD' kemarin menurut WIB. Aritmetika kalender dilakukan di UTC
// supaya tidak terpengaruh zona waktu perangkat.
export function yesterdayWib(date = new Date()) {
  const d = new Date(`${todayWib(date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// 'YYYY-MM' bulan berjalan menurut WIB.
export function currentMonthWib(date = new Date()) {
  return todayWib(date).slice(0, 7);
}

// Indeks hari (0 = Minggu ... 6 = Sabtu) menurut WIB; searah HARI_LABEL.
export function dayIndexWib(date = new Date()) {
  return new Date(`${todayWib(date)}T00:00:00Z`).getUTCDay();
}

// 'HH:MM' (WIB) dari timestamptz ISO, untuk nilai awal <input type="time">.
export function isoToWibTime(iso) {
  if (!iso) return '';
  return jamJakarta(new Date(iso)).slice(0, 5);
}

// Gabungkan tanggal record (YYYY-MM-DD) + jam 'HH:MM' yang dimaksud sebagai
// WIB menjadi ISO timestamptz utuh. Kosong -> null.
export function wibToIso(tanggal, timeValue) {
  if (!tanggal || !timeValue) return null;
  return new Date(`${tanggal}T${timeValue}:00${WIB_OFFSET}`).toISOString();
}
