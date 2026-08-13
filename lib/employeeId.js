// Auto-generate Employee ID berformat MDL0001 (prefix + 4 digit, jadi
// muat sampai MDL9999 sebelum perlu naik ke 5 digit). Dipakai di
// /api/employee/create (single) dan /api/employee/bulk-create (bulk import).
//
// Employee ID TIDAK disimpan sebagai counter terpisah di database — supaya
// tidak perlu migration/RPC baru seperti nomor surat. Nomor berikutnya
// dihitung dari ID tertinggi yang sudah ada di tabel `employees`, jadi
// selama employee_id lama formatnya konsisten "MDL" + angka, ini aman.
//
// Kalau suatu saat butuh ganti prefix atau jumlah digit, cukup ubah 2
// konstanta di bawah ini.
export const EMPLOYEE_ID_PREFIX = 'MDL';
export const EMPLOYEE_ID_PAD = 4; // 4 digit -> MDL0001 s.d. MDL9999

const idPattern = new RegExp(`^${EMPLOYEE_ID_PREFIX}(\\d+)$`, 'i');

// Cari angka tertinggi dari daftar employee_id yang sudah ada.
export function highestEmployeeNumber(existingIds = []) {
  let max = 0;
  for (const raw of existingIds) {
    if (!raw) continue;
    const match = idPattern.exec(String(raw).trim());
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

// Format satu nomor urut jadi employee_id, misal 1 -> "MDL0001".
export function formatEmployeeId(n) {
  return `${EMPLOYEE_ID_PREFIX}${String(n).padStart(EMPLOYEE_ID_PAD, '0')}`;
}

// Employee ID berikutnya berdasarkan daftar ID yang sudah ada + offset
// (dipakai saat bulk import: offset naik tiap baris yang butuh ID baru,
// supaya tidak tabrakan sesama baris dalam satu batch yang sama).
export function nextEmployeeId(existingIds = [], offset = 0) {
  return formatEmployeeId(highestEmployeeNumber(existingIds) + 1 + offset);
}