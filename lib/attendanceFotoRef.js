import { signConfirmToken, verifyConfirmToken } from '@/lib/attendanceConfirmToken';
import { DRIVE_REF_PREFIX, isValidDriveFileId } from '@/lib/attendancePhotoUrl';

// Referensi foto absensi (server only).
//
// Alur: browser mengirim foto ke /api/attendance/foto -> server mengunggahnya ke
// Google Drive -> server mengembalikan `fotoRef` BERTANDA TANGAN yang mengikat
// (karyawan, fileId). Browser lalu menyertakan fotoRef itu saat clock in/out.
// Server hanya menyimpan 'drive:<fileId>' kalau tanda tangannya valid DAN milik
// karyawan yang sedang login.
//
// Kenapa perlu ditandatangani: kalau browser boleh mengirim fileId mentah, karyawan
// bisa menempelkan ID file Drive sembarang (foto orang lain, dokumen lain di Shared
// Drive) ke absensinya, dan route proxy admin akan ikut menyajikannya. Tanda tangan
// memastikan hanya file yang benar-benar diunggah lewat route foto yang bisa dirujuk.
//
// Memakai kunci & format yang sama dengan token konfirmasi absensi
// (lib/attendanceConfirmToken.js), dibedakan lewat field `k: 'foto'` supaya token
// konfirmasi tidak bisa dipakai sebagai fotoRef, dan sebaliknya.

export const FOTO_REF_TTL_MS = 15 * 60 * 1000; // cukup untuk layar review (token konfirmasi 5 menit)
const KIND = 'foto';

export function signFotoRef(empId, fileId) {
  return signConfirmToken(
    { k: KIND, emp: String(empId), fid: fileId },
    { ttlMs: FOTO_REF_TTL_MS }
  ).token;
}

// Menerjemahkan nilai `fotoPath` kiriman client menjadi nilai yang boleh disimpan.
// Return { ok: true, value } (value null = tanpa foto) atau { ok: false }.
//   - null/undefined            -> tanpa foto
//   - '<empId>/…'               -> path Supabase Storage lama (klien yang belum refresh
//                                  setelah deploy); hanya boleh di folder milik sendiri
//   - fotoRef bertanda tangan   -> 'drive:<fileId>'
export function resolveFotoRef(fotoRef, empId) {
  if (fotoRef === null || fotoRef === undefined) return { ok: true, value: null };
  if (typeof fotoRef !== 'string') return { ok: false };

  if (fotoRef.startsWith(`${empId}/`)) {
    if (fotoRef.length > 300 || fotoRef.includes('..')) return { ok: false };
    return { ok: true, value: fotoRef };
  }

  const verified = verifyConfirmToken(fotoRef);
  if (!verified.ok) return { ok: false };
  const p = verified.payload;
  if (p.k !== KIND || String(p.emp) !== String(empId) || !isValidDriveFileId(p.fid)) {
    return { ok: false };
  }
  return { ok: true, value: `${DRIVE_REF_PREFIX}${p.fid}` };
}
