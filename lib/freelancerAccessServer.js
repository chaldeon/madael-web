import { getSessionFreelancer } from '@/lib/sessionFreelancer';
import { isFreelancerModuleGranted } from '@/lib/freelancerModules';

// SERVER ONLY — gate generik untuk API route Freelancer: harus login sebagai
// Freelancer + akun `active` + punya SALAH SATU modul yang diminta. Padanan
// requireModuleAccess (lib/moduleAccessServer.js) untuk Freelancer. Route yang
// memakai service role tidak dijaga RLS, jadi hak modul WAJIB dicek di sini.
//
// admin : client service role dari createAdminClient()
// keys  : array key modul Freelancer (lihat FREELANCER_MODULE_REGISTRY)
// Return { freelancer } kalau lolos, atau { error, status } untuk dikirim sebagai JSON.
//
// Catatan A3: gating "Agreement harus terverifikasi" ditambahkan di fungsi ini
// (untuk modul bertanda gated) supaya semua route Freelancer otomatis ikut terkunci.
export async function requireFreelancerModule(admin, keys) {
  const session = await getSessionFreelancer('id, freelancer_code, nama_lengkap, status');
  if (session.error) return { error: session.error, status: session.status };
  const { freelancer } = session;

  const { data: mods, error } = await admin
    .from('freelancer_modules')
    .select('module_name')
    .eq('freelancer_id', freelancer.id)
    .in('module_name', keys);
  if (error) throw error;

  const moduleKeys = (mods || []).map((m) => m.module_name);
  const allowed = keys.some((key) =>
    isFreelancerModuleGranted({ status: freelancer.status, moduleKeys, key })
  );
  if (!allowed) return { error: 'Anda tidak punya akses ke fitur ini.', status: 403 };

  return { freelancer };
}
