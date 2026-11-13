import { FREELANCER_STATUS, FREELANCER_STATUS_OPTIONS } from '@/lib/freelancerModules';

// Konfigurasi bersama (browser + server) untuk modul "Kelola Freelancer" (A2).
// Halaman admin sengaja berada di /employee/freelancer-admin, BUKAN di bawah
// /employee/freelancer: folder itu milik dashboard Freelancer sendiri (A1, A3, A4)
// dan akan memakai layout/guard Freelancer, sedangkan halaman ini untuk karyawan
// pemegang modul `freelancer_admin`.
export const FREELANCER_ADMIN_BASE = '/employee/freelancer-admin';

export const FREELANCER_TEXT_MAX = {
  nama_lengkap: 120,
  email: 160,
  no_whatsapp: 20,
  alamat: 500,
};

// Kolom yang boleh dikirim ke browser admin. Kolom sensitif (nama_bank,
// nomor_rekening, nama_pemilik_rekening, npwp_nik) SENGAJA tidak ada: A2 tidak
// membutuhkannya, dan tampilan masked-nya dikerjakan di A4.
export const FREELANCER_ADMIN_COLUMNS =
  'id, freelancer_code, nama_lengkap, email, no_whatsapp, alamat, tanggal_bergabung, status, cv_url, auth_user_id, created_at';

// Kolom yang bisa diurutkan dari tabel (nilai = nama kolom di database).
export const FREELANCER_SORT_COLUMNS = {
  freelancer_code: 'Freelancer ID',
  nama_lengkap: 'Nama',
  email: 'Email',
  status: 'Status',
  tanggal_bergabung: 'Bergabung',
};

export const FREELANCER_FILTER_STATUS_OPTIONS = [{ value: '', label: 'Semua status' }, ...FREELANCER_STATUS_OPTIONS];

// CV Freelancer: PDF/JPG/PNG (sama seperti dokumen karyawan; isi file diperiksa
// dari byte awalnya di server, lihat lib/uploadServer.js).
export const FREELANCER_CV_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
};
export const FREELANCER_CV_LABEL_JENIS = 'PDF, JPG, atau PNG';

// Isi kolom cv_url: "drive:<id file Google Drive>". Awalan dipakai supaya nilai
// ini tidak tertukar dengan URL biasa bila suatu saat format lain dipakai.
const CV_PREFIX = 'drive:';
export function cvRefFromDriveId(fileId) {
  return `${CV_PREFIX}${fileId}`;
}
export function driveIdFromCvRef(ref) {
  const text = String(ref || '');
  return text.startsWith(CV_PREFIX) && text.length > CV_PREFIX.length ? text.slice(CV_PREFIX.length) : null;
}

// 'YYYY-MM-DD' menurut WIB (bukan UTC), supaya tanggal bergabung default tidak
// mundur sehari di pagi hari.
export function hariIniWib() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

export const emptyFreelancerForm = {
  nama_lengkap: '',
  email: '',
  no_whatsapp: '',
  alamat: '',
  tanggal_bergabung: '',
};

const EMAIL_RE = /^[^\s@,;()<>"]+@[^\s@,;()<>"]+\.[^\s@,;()<>"]+$/;
const WA_RE = /^\+?[0-9][0-9\s-]{6,18}[0-9]$/;
const TANGGAL_RE = /^\d{4}-\d{2}-\d{2}$/;

function tanggalValid(value) {
  if (!TANGGAL_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Validasi + normalisasi isian form tambah/edit. Dipakai di browser (pesan cepat)
// DAN di server (yang menjadi penjaga sebenarnya).
//   input    : { nama_lengkap, email, no_whatsapp, alamat, tanggal_bergabung, status? }
//   mode     : 'create' | 'update'. Email hanya divalidasi/dikembalikan saat 'create'
//              (email = identitas login, tidak diubah dari sini).
// Return { error } atau { values } (nilai kosong -> null, email huruf kecil).
export function validateFreelancerInput(input, { mode = 'create' } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  const nama_lengkap = str(src.nama_lengkap).replace(/\s+/g, ' ');
  if (!nama_lengkap) return { error: 'Nama lengkap wajib diisi.' };
  if (nama_lengkap.length > FREELANCER_TEXT_MAX.nama_lengkap) {
    return { error: `Nama lengkap maksimal ${FREELANCER_TEXT_MAX.nama_lengkap} karakter.` };
  }

  const values = { nama_lengkap };

  if (mode === 'create') {
    const email = str(src.email).toLowerCase();
    if (!email) return { error: 'Email wajib diisi.' };
    if (email.length > FREELANCER_TEXT_MAX.email || !EMAIL_RE.test(email)) {
      return { error: 'Format email tidak valid.' };
    }
    values.email = email;
  }

  const wa = str(src.no_whatsapp);
  if (wa) {
    if (wa.length > FREELANCER_TEXT_MAX.no_whatsapp || !WA_RE.test(wa)) {
      return { error: 'Nomor WhatsApp tidak valid. Gunakan angka, boleh diawali + (contoh: 081234567890).' };
    }
    values.no_whatsapp = wa;
  } else {
    values.no_whatsapp = null;
  }

  const alamat = str(src.alamat);
  if (alamat.length > FREELANCER_TEXT_MAX.alamat) {
    return { error: `Alamat maksimal ${FREELANCER_TEXT_MAX.alamat} karakter.` };
  }
  values.alamat = alamat || null;

  const tanggal = str(src.tanggal_bergabung);
  if (tanggal) {
    if (!tanggalValid(tanggal)) return { error: 'Tanggal bergabung tidak valid.' };
    values.tanggal_bergabung = tanggal;
  } else {
    // Saat tambah, kosong = pakai default database (tanggal hari ini). Saat edit,
    // tanggal bergabung wajib ada (kolomnya tidak boleh dikosongkan).
    if (mode === 'update') return { error: 'Tanggal bergabung wajib diisi.' };
    values.tanggal_bergabung = null;
  }

  return { values };
}

export function isValidFreelancerStatus(status) {
  return Object.values(FREELANCER_STATUS).includes(status);
}
