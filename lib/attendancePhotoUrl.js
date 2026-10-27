// Helper foto absensi yang AMAN dipakai di client (tanpa node:crypto).
// Bagian yang butuh tanda tangan/rahasia ada di lib/attendanceFotoRef.js (server only)
// — jangan impor file itu dari komponen client.
//
// Nilai di kolom attendance.foto_clock_in_url / foto_clock_out_url ada dua bentuk:
//   'drive:<fileId>'           foto di Google Drive (Shared Drive "Absensi") — bentuk baru
//   '<empId>/<tanggal>-....jpg' foto lama di Supabase Storage, bucket `attendance-photos`
// Foto lama tidak dimigrasi otomatis, jadi kedua bentuk harus tetap terbaca.

export const DRIVE_REF_PREFIX = 'drive:';

// ID file Google Drive: huruf, angka, '-' dan '_'. Dipakai juga sebagai pembatas
// input di route proxy supaya tidak ada karakter aneh masuk ke query/URL.
const DRIVE_FILE_ID_RE = /^[A-Za-z0-9_-]{10,100}$/;

export function isValidDriveFileId(id) {
  return typeof id === 'string' && DRIVE_FILE_ID_RE.test(id);
}

export function isDriveRef(value) {
  return typeof value === 'string' && value.startsWith(DRIVE_REF_PREFIX);
}

// 'drive:abc' -> 'abc' (atau null kalau bukan referensi Drive yang valid)
export function driveFileIdFromRef(value) {
  if (!isDriveRef(value)) return null;
  const id = value.slice(DRIVE_REF_PREFIX.length);
  return isValidDriveFileId(id) ? id : null;
}

// URL yang dipakai <img>/<a> untuk foto di Drive. File Drive tidak bisa di-hotlink
// langsung, jadi dilayani lewat route proxy yang mengecek hak akses (superadmin).
export function driveFotoUrl(value) {
  const id = driveFileIdFromRef(value);
  return id ? `/api/attendance/foto/${id}` : null;
}


// Peta { <nilai kolom foto>: <URL untuk <img>> } untuk banyak foto sekaligus.
// 'drive:<id>' -> lewat route proxy; path lama -> signed URL Supabase Storage (1 jam,
// butuh `supabase` client yang boleh membaca bucket attendance-photos).
export async function resolveAttendancePhotoUrls(supabase, refs) {
  const map = {};
  const legacyPaths = [];
  for (const v of new Set((refs || []).filter(Boolean))) {
    if (isDriveRef(v)) {
      const url = driveFotoUrl(v);
      if (url) map[v] = url;
    } else {
      legacyPaths.push(v);
    }
  }
  if (legacyPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attendance-photos')
      .createSignedUrls(legacyPaths, 60 * 60);
    (signed || []).forEach((s) => {
      if (s?.signedUrl && s?.path) map[s.path] = s.signedUrl;
    });
  }
  return map;
}
