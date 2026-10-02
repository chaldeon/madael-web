// SERVER ONLY — dipakai route /api/applications/[id]/messages.

// Kolom riwayat yang boleh dikirim balik ke browser.
export const MESSAGE_COLUMNS =
  'id, application_id, channel, template, source, status, recipient, subject, body, error, sent_by_nama, created_at, confirmed_at';

// Pengecekan akses (full / terbatas per lowongan) ada di lib/jobPortalServer.js;
// di-re-export di sini supaya import lama tetap jalan.
export { requireJobPortalAccess } from '@/lib/jobPortalServer';

// Catat satu entri riwayat. Mengembalikan { data } atau { error }, TIDAK
// melempar — pemanggil memutuskan apa yang dikatakan ke user. Pesan yang
// sudah terkirim tidak boleh dianggap gagal hanya karena riwayatnya tidak
// tercatat (mis. migrasi SQL belum dijalankan).
export async function recordApplicationMessage(admin, row) {
  const { data, error } = await admin
    .from('application_messages')
    .insert([row])
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) {
    console.error('Gagal mencatat riwayat pesan pelamar:', error);
    return { error };
  }
  return { data };
}
