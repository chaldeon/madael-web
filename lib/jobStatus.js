// Status efektif lowongan = flag manual `is_active` + deadline `closes_at`.
//
// Lowongan dianggap "ditutup otomatis" begitu tanggal hari ini (WIB) LEWAT dari
// closes_at. Hari deadline itu sendiri masih terbuka sampai 23:59 WIB, jadi
// deadline "5 Oktober" artinya pelamar masih bisa apply sepanjang 5 Oktober.
//
// Tidak ada kolom/cron baru: `is_active` tetap saklar manual admin, dan status
// "ditutup" dihitung dari tanggal setiap kali dibaca. Admin membuka kembali
// dengan memperpanjang atau mengosongkan deadline (tanpa deadline = tidak
// pernah tutup otomatis).
//
// Dipakai di: halaman publik /karir, endpoint /api/apply (penegakan di server),
// sitemap, statistik, dan tabel admin job portal.

import { todayJakarta } from '@/lib/serverTime';

// closes_at bertipe date ('YYYY-MM-DD'). slice(0, 10) menjaga tetap aman kalau
// suatu saat nilainya datang sebagai timestamp ISO.
export function getDeadlineDate(job) {
  const raw = job?.closes_at;
  if (!raw) return null;
  const s = String(raw).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// true kalau ada deadline dan tanggalnya sudah lewat dari hari ini (WIB).
export function isPastDeadline(job, today = todayJakarta()) {
  const deadline = getDeadlineDate(job);
  return deadline !== null && deadline < today;
}

// true kalau lowongan boleh tampil & menerima lamaran.
export function isJobOpen(job, today = todayJakarta()) {
  return !!job?.is_active && !isPastDeadline(job, today);
}

// 'open'     → aktif & belum lewat deadline
// 'expired'  → aktif secara manual, tapi deadline sudah lewat (tutup otomatis)
// 'inactive' → dinonaktifkan manual oleh admin (menang atas deadline)
export function getJobStatus(job, today = todayJakarta()) {
  if (!job?.is_active) return 'inactive';
  return isPastDeadline(job, today) ? 'expired' : 'open';
}
