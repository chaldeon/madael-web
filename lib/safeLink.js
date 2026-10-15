// Validasi `link` notifikasi: hanya path internal aplikasi yang boleh dipakai.
// Aman dipakai di klien maupun server (tanpa import khusus-server).
//
// Lolos : '/employee/leave-request/admin', '/employee/absensi?tab=koreksi'
// Ditolak: 'https://evil.example', '//evil.example', '/\evil.example',
//          'javascript:...', link dengan spasi/kontrol, atau > 300 karakter.
// Dipakai di dua sisi: saat menulis (lib/notify.js) dan saat merender
// (NotificationBell, Pusat Notifikasi) sebagai lapis kedua untuk baris lama.
export function safeInternalPath(link) {
  if (typeof link !== 'string') return null;
  if (link.length === 0 || link.length > 300) return null;
  if (!/^\/(?:[^/\\]|$)/.test(link)) return null; // harus '/x', bukan '//' atau '/\'
  if (/[\u0000-\u0020\u007f\\]/.test(link)) return null; // spasi, kontrol, backslash
  return link;
}
