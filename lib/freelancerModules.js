import { UserCircle, Briefcase } from 'lucide-react';

// Registry modul untuk akun FREELANCER. Sengaja terpisah dari MODULE_REGISTRY
// (lib/employeeModules.js): Freelancer bukan baris di `employees`, jadi tidak ikut
// sistem employee_modules, dan modul karyawan tidak pernah bisa tampil/terbuka
// untuk Freelancer. Hak akses disimpan di tabel `freelancer_modules`
// (freelancer_id -> freelancers.id, module_name).
//
// status : 'live' (halaman sudah ada) | 'coming_soon' (belum dibangun; kartu tampil
//          nonaktif). Ubah ke 'live' saat halaman tujuan selesai (A4 untuk profil,
//          B2 untuk lowongan).
// gated  : true = baru terbuka setelah Agreement terverifikasi (dipasang di A3).
//          Profil Saya dan halaman Agreement sengaja tidak gated.
export const FREELANCER_MODULE_REGISTRY = [
  {
    key: 'freelancer_profile',
    name: 'Profil Saya',
    desc: 'Lengkapi data rekening, NPWP/NIK, dan lihat data akun Freelancer kamu',
    href: '/employee/freelancer/profil',
    status: 'coming_soon',
    icon: UserCircle,
    gated: false,
  },
  {
    key: 'freelancer_job_portal',
    name: 'Dashboard Karir',
    desc: 'Lihat lowongan aktif dan prioritas, lalu buat link referral kamu',
    href: '/employee/freelancer/lowongan',
    status: 'coming_soon',
    icon: Briefcase,
    gated: true,
  },
];

export const FREELANCER_MODULE_KEYS = FREELANCER_MODULE_REGISTRY.map((m) => m.key);

// Modul yang otomatis di-grant ke Freelancer baru (dipakai route pembuatan akun
// di A2). Awalnya hanya dua modul ini, sesuai keputusan Tahap A.
export const DEFAULT_FREELANCER_MODULE_ACCESS = ['freelancer_profile', 'freelancer_job_portal'];

// Key modul KARYAWAN untuk tim yang mengelola Freelancer (A2). Ini key biasa di
// employee_modules (sudah ditambahkan ke CHECK constraint lewat a1_01_freelancers.sql),
// bukan modul Freelancer. Registry/halamannya ditambahkan di A2.
export const FREELANCER_ADMIN_MODULE = 'freelancer_admin';

// Status akun Freelancer. Nilai = isi kolom `status` (huruf kecil, sama dengan
// CHECK constraint); label = teks tampilan.
export const FREELANCER_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  SUSPENDED: 'suspended',
};

export const FREELANCER_STATUS_OPTIONS = [
  { value: FREELANCER_STATUS.ACTIVE, label: 'Active' },
  { value: FREELANCER_STATUS.INACTIVE, label: 'Inactive' },
  { value: FREELANCER_STATUS.SUSPENDED, label: 'Suspended' },
];

export function freelancerStatusLabel(status) {
  return FREELANCER_STATUS_OPTIONS.find((o) => o.value === status)?.label || status || '-';
}

export function isFreelancerActive(freelancer) {
  return freelancer?.status === FREELANCER_STATUS.ACTIVE;
}

// Satu-satunya tempat aturan "boleh akses modul Freelancer X?". Akun harus
// `active` DAN punya baris modulnya. (Gating Agreement ditambahkan di A3 di sini.)
export function isFreelancerModuleGranted({ status, moduleKeys, key }) {
  if (status !== FREELANCER_STATUS.ACTIVE) return false;
  return (moduleKeys || []).includes(key);
}
