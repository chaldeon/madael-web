import { getSessionEmployee } from '@/lib/sessionEmployee';
import { isModuleGranted } from '@/lib/employeeModules';

// SERVER ONLY — dipakai route /api/applications/[id]/messages dan
// /api/applications/[id]/status-email.

// Kolom riwayat yang boleh dikirim balik ke browser.
export const MESSAGE_COLUMNS =
  'id, application_id, channel, template, source, status, recipient, subject, body, error, sent_by_nama, created_at, confirmed_at';

// Sama dengan pengecekan di route status-email: login + akun aktif +
// (superadmin atau pemegang modul job_portal).
// Return { emp } kalau lolos, atau { error, status } untuk dikirim sebagai JSON.
export async function requireJobPortalAccess(admin) {
  const session = await getSessionEmployee('id, nama, status, is_superadmin');
  if (session.error) return { error: session.error, status: session.status };
  const { emp } = session;

  const { data: mods, error } = await admin
    .from('employee_modules')
    .select('module_name')
    .eq('employee_id', emp.id)
    .eq('module_name', 'job_portal');
  if (error) throw error;

  const allowed = isModuleGranted({
    isSuperadmin: emp.is_superadmin,
    moduleKeys: (mods || []).map((m) => m.module_name),
    key: 'job_portal',
  });
  if (!allowed) return { error: 'Anda tidak punya akses ke modul Job Portal.', status: 403 };

  return { emp };
}

// Catat satu entri riwayat. Mengembalikan { data } atau { error }, TIDAK
// melempar — pemanggil memutuskan apa yang dikatakan ke user. Dipakai juga
// oleh email status otomatis, yang tidak boleh gagal hanya karena riwayat
// tidak tercatat (mis. migrasi SQL belum dijalankan).
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
