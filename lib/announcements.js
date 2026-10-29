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
