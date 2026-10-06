import { getSessionEmployee } from '@/lib/sessionEmployee';
import { isModuleGranted } from '@/lib/employeeModules';

// SERVER ONLY — gate generik "harus login + akun aktif + punya salah satu
// modul". Dipakai API route yang memakai service role (RLS tidak berlaku di
// sana, jadi hak modul HARUS dicek manual). Pola query-nya sama dengan
// requireJobPortalAccess (lib/jobPortalServer.js).
//
// admin : client service role dari createAdminClient()
// keys  : array key modul; lolos kalau superadmin ATAU punya SALAH SATU key
//         (superadmin tidak bypass modul di EXPLICIT_ONLY_MODULES)
// Return { emp } kalau lolos, atau { error, status } untuk dikirim sebagai JSON.
export async function requireModuleAccess(admin, keys) {
  const session = await getSessionEmployee('id, nama, status, is_superadmin');
  if (session.error) return { error: session.error, status: session.status };
  const { emp } = session;

  const { data: mods, error } = await admin
    .from('employee_modules')
    .select('module_name')
    .eq('employee_id', emp.id)
    .in('module_name', keys);
  if (error) throw error;

  const moduleKeys = (mods || []).map((m) => m.module_name);
  const allowed = keys.some((key) =>
    isModuleGranted({ isSuperadmin: !!emp.is_superadmin, moduleKeys, key })
  );
  if (!allowed) return { error: 'Anda tidak punya akses ke fitur ini.', status: 403 };

  return { emp };
}
