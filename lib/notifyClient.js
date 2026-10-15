// Pemicu notifikasi dari browser — fire and forget.
// Browser TIDAK menulis ke tabel notifications. Ia hanya memberi tahu server
// "event X terjadi pada record Y"; server memverifikasi lalu menyusun dan
// mengirim notifikasinya (lihat app/api/notifications/dispatch dan
// lib/notificationEvents.js untuk daftar event yang valid).
// Gagal mengirim tidak boleh mengganggu aksi utama yang sudah tersimpan.
export function dispatchNotification(event, id) {
  if (!event || !id) return;
  try {
    fetch('/api/notifications/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, id }),
      keepalive: true,
    }).catch((err) => console.error('Gagal memicu notifikasi:', err));
  } catch (err) {
    console.error('Gagal memicu notifikasi:', err);
  }
}
