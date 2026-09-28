// Format teks QR absensi yang aman dipakai di client (tanpa node:crypto).
// Bentuk lengkap dibuat & diverifikasi di server: lib/attendanceQr.js.
//   MADAEL-ABS:v1:<lokasiId>:<versi>:<tandaTangan>

export const QR_PREFIX = 'MADAEL-ABS';

// Cek cepat di browser supaya QR asing (mis. QR pembayaran) langsung ditolak
// tanpa perlu ke server. Validasi sebenarnya tetap di server.
export function looksLikeAttendanceQr(text) {
  return typeof text === 'string' && text.startsWith(`${QR_PREFIX}:`) && text.length <= 200;
}
