// SERVER ONLY — pencatatan riwayat perubahan status pelamar.
import { logActivity } from '@/lib/activityLog';

export const STATUS_HISTORY_MIGRATION_HINT =
  'Riwayat status belum tersimpan karena tabel belum ada. Jalankan migrasi SQL scripts/sql/application_status_history.sql di Supabase.';

export const STATUS_HISTORY_COLUMNS =
  'id, application_id, from_status, to_status, reason, changed_by_nama, created_at';

// 42P01 = tabel tidak ada (Postgres); PGRST205 = tabel tidak ada di schema cache (PostgREST).
export function isMissingTableError(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

// Catat satu perubahan status: baris riwayat + activity log.
// TIDAK melempar — status sudah berubah di database, jadi gagal mencatat tidak
// boleh membuat perubahan itu dianggap gagal. Mengembalikan:
//   { entry }                 riwayat tersimpan
//   { error, missingTable }   riwayat gagal tersimpan (activity log tetap dicoba)
export async function recordStatusChange(admin, { app, fromStatus, toStatus, reason = null, emp }) {
  const { data: entry, error } = await admin
    .from('application_status_history')
    .insert([
      {
        application_id: app.id,
        from_status: fromStatus || null,
        to_status: toStatus,
        reason: reason || null,
        changed_by: emp.id,
        changed_by_nama: emp.nama || null,
      },
    ])
    .select(STATUS_HISTORY_COLUMNS)
    .single();

  if (error) console.error('Gagal mencatat riwayat status pelamar:', error);

  await logActivity(admin, {
    userId: emp.id,
    aksi: 'ubah_status_pelamar',
    targetTable: 'applications',
    targetId: app.id,
    detail: {
      nama: app.nama,
      posisi: app.job_listings?.title || 'CV Umum',
      dari: fromStatus,
      ke: toStatus,
      ...(reason ? { alasan: reason } : {}),
    },
  });

  if (error) return { error, missingTable: isMissingTableError(error) };
  return { entry };
}
