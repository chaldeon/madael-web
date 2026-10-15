// Pencatat activity log dari browser — fire and forget.
// Browser TIDAK menulis ke tabel activity_logs. Pencatatan lewat
// /api/activity-log: server mengambil user_id dari sesi login (bukan dari
// pemanggil), dan hanya menerima aksi yang terdaftar di
// lib/activityLogPolicy.js. Gagal mencatat tidak boleh membatalkan aksi utama.
export function logActivity({ aksi, targetTable = null, targetId = null, detail = null }) {
  if (!aksi) return;
  try {
    fetch('/api/activity-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aksi, targetTable, targetId, detail }),
      keepalive: true,
    }).catch((err) => console.error('Gagal mencatat activity log:', err));
  } catch (err) {
    console.error('Gagal mencatat activity log:', err);
  }
}
