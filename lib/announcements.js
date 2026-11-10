// Helper bersama untuk pengumuman karyawan — dipakai banner di Dashboard dan
// halaman arsip /employee/pengumuman, supaya keduanya memakai aturan yang sama
// (kedaluwarsa, target perusahaan, urutan).

// Pengumuman aktif = belum ada expired_at, atau expired_at masih di masa
// depan. Dicek ulang di RLS/insert admin, ini cuma filter tampilan.
export function isActive(row) {
  return !row.expired_at || new Date(row.expired_at) > new Date();
}

// Pengumuman tanpa target (target_company_id kosong) untuk semua karyawan;
// yang bertarget hanya untuk karyawan di perusahaan itu. RLS sudah membatasi
// untuk karyawan biasa, tapi pengelola/superadmin bisa membaca semuanya, jadi
// tampilan tetap menyaring berdasarkan perusahaan karyawan yang sedang login.
export function isForCompany(row, clientId) {
  if (row.target_company_id === null || row.target_company_id === undefined) return true;
  return clientId !== null && clientId !== undefined && String(row.target_company_id) === String(clientId);
}

export const ANNOUNCEMENT_COLUMNS = 'id, judul, isi, expired_at, pinned, target_company_id, created_at';

// Query pengumuman yang masih berlaku untuk satu perusahaan, terurut pin dulu
// lalu terbaru. Kedaluwarsa dan target disaring di query (bukan cuma di client).
// Pemanggil menambahkan batas sendiri (.limit) atau memakai fetchAllRows.
export function activeAnnouncementsQuery(supabase, clientId) {
  const nowIso = new Date().toISOString();
  const targetFilter = clientId
    ? `target_company_id.is.null,target_company_id.eq.${clientId}`
    : 'target_company_id.is.null';
  return supabase
    .from('announcements')
    .select(ANNOUNCEMENT_COLUMNS)
    .or(`expired_at.is.null,expired_at.gt.${nowIso}`)
    .or(targetFilter)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false });
}

// Jendela kirim ulang notifikasi pengumuman. Pengumuman yang belum pernah
// ditandai disiarkan (broadcast_at kosong) hanya boleh disiarkan ulang kalau
// masih aktif dan dibuat dalam jendela ini. Tujuannya melindungi pengumuman
// lama (dibuat sebelum kolom broadcast_at ada, atau sebelum ada notifikasi
// broadcast) agar tidak ikut menyiarkan notifikasi massal secara tidak sengaja.
export const JENDELA_KIRIM_ULANG_MS = 7 * 24 * 60 * 60 * 1000;

// true bila notifikasi pengumuman ini boleh dikirim (ulang) oleh admin.
// `broadcast_at === null` ketat: bila kolom tidak ikut terbaca (undefined),
// tombol tidak ditampilkan.
export function bisaKirimUlangNotifikasi(row, now = Date.now()) {
  if (!row || row.broadcast_at !== null) return false;
  if (!isActive(row)) return false;
  const dibuat = new Date(row.created_at).getTime();
  if (Number.isNaN(dibuat)) return false;
  return now - dibuat <= JENDELA_KIRIM_ULANG_MS;
}
