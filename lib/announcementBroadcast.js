// SERVER ONLY — menyiarkan notifikasi "pengumuman baru" dari server.
//
// Dulu halaman admin memicu event pengumuman_baru lewat fetch fire-and-forget
// dari browser: kalau tab ditutup, koneksi putus, atau server gagal, pengumuman
// sudah tersimpan tetapi notifikasinya tidak pernah terkirim dan admin tidak
// punya jalan untuk mengulang. Sekarang:
//   - POST /api/announcements menyiarkan sendiri setelah pengumuman tersimpan;
//   - POST /api/announcements/[id]/broadcast jadi jalur kirim ulang.
//
// Pakai definisi event yang sama dengan /api/notifications/dispatch
// (NOTIFICATION_EVENTS.pengumuman_baru): tanda broadcast_at diklaim atomik
// sebelum kirim, dilepas bila gagal, dan tiap penerima dijaga kunci dedupe
// `<tipe>:<id>`. Jadi memanggil ini berulang atau paralel tidak pernah
// menotifikasi orang yang sama dua kali.
//
// Tidak pernah melempar error. Mengembalikan salah satu:
//   { status: 'terkirim', inserted }   — notifikasi terkirim
//   { status: 'sudah_disiarkan' }      — sudah pernah disiarkan (klaim kalah)
//   { status: 'dilewati' }             — pengumuman tidak ada / nonaktif
//   { status: 'gagal' }                — gagal; tanda siaran dilepas, bisa diulang
import { NOTIFICATION_EVENTS, MAKS_PESAN } from '@/lib/notificationEvents';
import { kirimKePenerima } from '@/lib/notificationDispatch';

export async function siarkanPengumuman(admin, id) {
  const def = NOTIFICATION_EVENTS.pengumuman_baru;
  let claimed = false;
  try {
    const result = await def.build({ admin, id });
    if (!result) return { status: 'dilewati' };

    claimed = await def.claim({ admin, id });
    if (!claimed) return { status: 'sudah_disiarkan' };

    const outcome = await kirimKePenerima(admin, result.to, {
      tipe: result.tipe,
      pesan: String(result.pesan).slice(0, MAKS_PESAN),
      link: result.link,
      dedupeKey: `${result.tipe}:${String(id)}`,
    });
    if (!outcome || outcome.ok === false) throw new Error('Pengiriman notifikasi pengumuman gagal.');
    return { status: 'terkirim', inserted: outcome.inserted };
  } catch (err) {
    console.error('Siarkan pengumuman gagal:', err);
    if (claimed) {
      try {
        await def.release({ admin, id });
      } catch (releaseErr) {
        console.error('Siarkan pengumuman gagal melepas tanda siaran:', releaseErr);
      }
    }
    return { status: 'gagal' };
  }
}
