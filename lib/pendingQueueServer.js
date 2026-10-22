// SERVER ONLY — konteks approver untuk antrean persetujuan: siapa yang login dan
// modul antrean mana yang boleh dia akses. Dipakai /api/dashboard/pending-counts
// dan /api/approvals/inbox supaya aturan aksesnya identik.
//
// admin : client service role dari createAdminClient()
// Return { emp, keys, excludeOwn } kalau lolos (keys bisa kosong: user tanpa modul
// approval), atau { error, status } untuk dikirim sebagai JSON.
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { PENDING_QUEUE_MODULES, isModuleGranted } from '@/lib/employeeModules';
import { PENDING_QUERIES } from '@/lib/pendingQueue';
import { SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN } from '@/lib/leave';

export async function getApproverContext(admin) {
  const session = await getSessionEmployee('id, nama, status, is_superadmin');
  if (session.error) return { error: session.error, status: session.status };
  const { emp } = session;

  const { data: mods, error: modsError } = await admin
    .from('employee_modules')
    .select('module_name')
    .eq('employee_id', emp.id)
    .in('module_name', PENDING_QUEUE_MODULES);
  if (modsError) {
    console.error('Muat modul antrean persetujuan error:', modsError);
    return { error: 'Gagal memuat.', status: 500 };
  }

  const moduleKeys = (mods || []).map((m) => m.module_name);
  const keys = PENDING_QUEUE_MODULES.filter(
    (key) =>
      PENDING_QUERIES[key] &&
      isModuleGranted({ isSuperadmin: !!emp.is_superadmin, moduleKeys, key })
  );

  const excludeOwn = !(SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN && emp.is_superadmin);
  return { emp, keys, excludeOwn };
}
