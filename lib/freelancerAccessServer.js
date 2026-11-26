import { getSessionFreelancer } from '@/lib/sessionFreelancer';
import { isFreelancerModuleGranted, isFreelancerModuleGated } from '@/lib/freelancerModules';
import { muatKelengkapanProfil, ringkasGalat } from '@/lib/freelancerProfile';
import { ambilStatusAgreement } from '@/lib/freelancerAdminServer';
import { evaluasiGate, PESAN_GATE_GAGAL } from '@/lib/freelancerGate';

// SERVER ONLY — gate generik untuk API route Freelancer: harus login sebagai
// Freelancer + akun `active` + punya SALAH SATU modul yang diminta. Padanan
// requireModuleAccess (lib/moduleAccessServer.js) untuk Freelancer. Route yang
// memakai service role tidak dijaga RLS, jadi hak modul WAJIB dicek di sini.
//
// GATE SYARAT AKSES (FRE-TOOL-07): bila SEMUA modul yang lolos grant bertanda `gated`
// di registry, Freelancer juga harus memenuhi syarat (profil lengkap + Agreement
// `terverifikasi`, lihat lib/freelancerGate.js). Bila ada modul yang tidak gated di
// antara keys yang lolos (mis. freelancer_profile), syarat tidak diperiksa, sehingga
// Profil Saya dan Agreement tetap terbuka sebelum syarat terpenuhi. Syarat yang
// belum terpenuhi -> 403 dengan pesan yang menyebut apa yang kurang; syarat yang
// tidak dapat diperiksa -> 503 (TERTUTUP, gagal aman).
//
// admin : client service role dari createAdminClient()
// keys  : array key modul Freelancer (lihat FREELANCER_MODULE_REGISTRY)
// Return { freelancer } kalau lolos, atau { error, status } untuk dikirim sebagai JSON.
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
  const granted = keys.filter((key) =>
    isFreelancerModuleGranted({ status: freelancer.status, moduleKeys, key })
  );
  if (granted.length === 0) return { error: 'Anda tidak punya akses ke fitur ini.', status: 403 };

  if (granted.every(isFreelancerModuleGated)) {
    let gate;
    try {
      gate = await muatSyaratGate(admin, freelancer.id);
    } catch (err) {
      // Hanya name/code yang dicatat: tidak ada nilai profil yang ikut ke log.
      console.error('Syarat akses Freelancer gagal diperiksa:', ringkasGalat(err));
      return { error: PESAN_GATE_GAGAL, status: 503 };
    }
    if (!gate.terpenuhi) return { error: gate.pesan, status: 403 };
  }

  return { freelancer };
}

// Syarat akses Freelancer dari database: kelengkapan profil (muatKelengkapanProfil)
// + status Agreement (ambilStatusAgreement), dievaluasi lewat evaluasiGate. Hanya
// indikator yang dikembalikan, tidak pernah nilai data pembayaran. MELEMPAR error
// bila salah satu pembacaan gagal: pemanggil wajib memperlakukannya sebagai tertutup.
export async function muatSyaratGate(admin, freelancerId) {
  const [kelengkapan, statusAgreement] = await Promise.all([
    muatKelengkapanProfil(admin, freelancerId),
    ambilStatusAgreement(admin, [freelancerId]),
  ]);
  return evaluasiGate({
    profil_lengkap: kelengkapan.lengkap,
    kolom_kosong: kelengkapan.kosong,
    agreement_status: statusAgreement.get(freelancerId) ?? null,
  });
}
