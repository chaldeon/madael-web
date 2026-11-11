// SERVER ONLY — pengajuan perubahan profil yang masih pending milik satu
// karyawan, dipakai untuk mendeteksi pengajuan yang bersinggungan (field yang
// sama). Aturannya ada di lib/profileFields.js.
//
// admin : client service role dari createAdminClient()
import {
  kunciBersinggunganDenganDaftar, pengajuanLebihLama,
} from '@/lib/profileFields';

// Semua pengajuan pending milik satu karyawan (jumlahnya kecil per karyawan,
// jadi tidak perlu paginasi). Return { rows, error }.
export async function muatPengajuanPending(admin, employeeId) {
  const { data, error } = await admin
    .from('profile_change_requests')
    .select('id, created_at, field_changes')
    .eq('employee_id', employeeId)
    .eq('status', 'pending');
  return { rows: data || [], error };
}

// Key dari `keys` yang bersinggungan dengan pengajuan pending LAIN milik
// karyawan yang sama. Kalau `pembanding` diisi (baris pengajuan), hanya
// pengajuan yang lebih lama daripada `pembanding` yang dihitung. Baris dengan
// id `kecualiId` tidak ikut dihitung.
export function temukanBersinggungan(rows, keys, { kecualiId = null, pembanding = null } = {}) {
  const kandidat = rows.filter((r) => {
    if (kecualiId !== null && String(r.id) === String(kecualiId)) return false;
    if (pembanding && !pengajuanLebihLama(r, pembanding)) return false;
    return true;
  });
  return kunciBersinggunganDenganDaftar(keys, kandidat);
}
