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


// SERVER ONLY — gate khusus Tool BPA1 (Bukti Potong A1). Dipakai API route BPA1
// berikutnya (BPA-05 dst.) yang memakai service role, jadi hak HARUS dicek di sini.
//
// Beda dari requireModuleAccess: di sana cukup SALAH SATU key, di sini WAJIB
// kedua key — 'payroll' DAN 'bpa1'. Alasannya mengikuti UI: halaman BPA1 ada di
// bawah /employee/payroll, yang layout-nya sudah menolak akun tanpa 'payroll'.
// Dengan syarat yang sama di server, API tidak lebih longgar dari halamannya
// dan akses halaman Payroll yang ada tidak diubah sama sekali. (Asumsi, belum
// diputuskan: kalau BPA1 nanti harus bisa berdiri sendiri tanpa 'payroll',
// layout payroll harus dipecah dulu — butuh keputusan, lihat K-08.)
//
// Superadmin tetap lolos lewat isModuleGranted (keduanya bukan explicit-only).
// Tidak ada pembatasan per klien di sini (BPA-03 ditunda).
// Return { emp } kalau lolos, atau { error, status } untuk dikirim sebagai JSON
// — bentuk sama dengan requireModuleAccess.
const BPA1_REQUIRED_KEYS = ['payroll', 'bpa1'];

export async function requireBpa1Access(admin) {
  const session = await getSessionEmployee('id, nama, status, is_superadmin');
  if (session.error) return { error: session.error, status: session.status };
  const { emp } = session;

  const { data: mods, error } = await admin
    .from('employee_modules')
    .select('module_name')
    .eq('employee_id', emp.id)
    .in('module_name', BPA1_REQUIRED_KEYS);
  if (error) throw error;

  const moduleKeys = (mods || []).map((m) => m.module_name);
  const allowed = BPA1_REQUIRED_KEYS.every((key) =>
    isModuleGranted({ isSuperadmin: !!emp.is_superadmin, moduleKeys, key })
  );
  if (!allowed) return { error: 'Anda tidak punya akses ke fitur ini.', status: 403 };

  return { emp };
}
