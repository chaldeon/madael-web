// Helper paginasi untuk daftar admin & laporan (cuti, lembur, reimbursement,
// slip gaji, dst).
//
// Kenapa perlu: PostgREST memotong respons di `max-rows` (bawaan Supabase 1.000)
// TANPA error, jadi daftar yang dimuat penuh akan "hilang" barisnya diam-diam
// seiring data bertambah. Daftar dimuat per halaman lewat `.range()` + `count`.
// Untuk angka TOTAL (jumlah rupiah, dsb.) pakai lib/fetchAllRows.js, bukan daftar
// berhalaman.

export const ADMIN_PAGE_SIZE_OPTIONS = [25, 50, 100];
export const ADMIN_PAGE_SIZE_DEFAULT = 50;
// Batas atas ukuran halaman dari query string. Harus <= max-rows Supabase (1.000)
// dan cukup kecil supaya `.in(...)` berisi id dari satu halaman tetap pendek.
export const ADMIN_PAGE_SIZE_MAX = 100;

const MAX_PAGE = 100000;

// Baca ?page=&pageSize= dari URLSearchParams. Nilai tak valid jatuh ke default.
// Mengembalikan { page, pageSize, from, to } — from/to untuk `.range(from, to)`.
export function parsePageParams(
  searchParams,
  { defaultSize = ADMIN_PAGE_SIZE_DEFAULT, maxSize = ADMIN_PAGE_SIZE_MAX } = {}
) {
  const pageRaw = Number.parseInt(searchParams.get('page') || '', 10);
  const sizeRaw = Number.parseInt(searchParams.get('pageSize') || '', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, MAX_PAGE) : 1;
  const pageSize = Number.isFinite(sizeRaw) && sizeRaw >= 1 ? Math.min(sizeRaw, maxSize) : defaultSize;
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

export function totalPagesOf(total, pageSize) {
  return Math.max(1, Math.ceil((Number(total) || 0) / pageSize));
}

// PostgREST menjawab 416 (PGRST103) kalau halaman yang diminta melewati akhir
// data — mis. halaman terakhir menjadi kosong setelah pengajuan diproses lalu
// daftar dimuat ulang. Pemanggil sebaiknya kembali ke halaman 1, bukan error.
export function isRangeNotSatisfiable(error) {
  if (!error) return false;
  return error.code === 'PGRST103' || /range not satisfiable/i.test(error.message || '');
}
