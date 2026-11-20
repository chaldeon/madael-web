import { friendlyError } from '@/lib/errorMessage';

// Profil Freelancer (FRE-TOOL-05): aturan "profil lengkap", validasi/normalisasi data
// pembayaran, dan helper server untuk membacanya. SATU-SATUNYA tempat aturan
// kelengkapan; route Profil Saya, respons admin, dan gate akses (FRE-TOOL-07) memakai
// fungsi yang sama supaya tidak ada aturan ganda.
//
// File ini tidak mengimpor modul khusus-server, jadi aman dipakai di browser
// (validasi cepat); helper yang membaca database menerima client `admin` dari
// pemanggil (createAdminClient, service role) dan hanya boleh dipanggil di server.
//
// DATA SENSITIF: nama_bank, nomor_rekening, nama_pemilik_rekening, npwp_nik tidak
// punya izin SELECT untuk role authenticated (hanya terbaca lewat service role).
// Nilainya tidak boleh masuk log atau pesan error. Catatan: pesan error Postgres
// membawa `details` ("Failing row contains (...)") yang memuat nilai SELURUH baris,
// dan friendlyError() mencatat objek error mentah ke console, jadi untuk kolom ini
// error database SELALU lewat pesanGalatProfil() di bawah, bukan friendlyError()
// langsung.

// Empat kolom data pembayaran = SATU-SATUNYA kolom yang boleh diubah Freelancer dari
// Profil Saya. Juga daftar kolom wajib "profil lengkap" (ASUMSI, FRE-Q-15 belum
// dijawab; tambahan kolom wajib cukup ditambahkan di sini dan di validatePaymentInput).
export const PROFILE_PAYMENT_FIELDS = ['nama_bank', 'nomor_rekening', 'nama_pemilik_rekening', 'npwp_nik'];
export const PROFILE_REQUIRED_FIELDS = PROFILE_PAYMENT_FIELDS;
export const PROFILE_PAYMENT_COLUMNS = PROFILE_PAYMENT_FIELDS.join(', ');

// Data akun yang tampil read-only di Profil Saya (Freelancer tidak dapat mengubahnya).
export const PROFILE_ACCOUNT_FIELDS = [
  'freelancer_code',
  'nama_lengkap',
  'email',
  'no_whatsapp',
  'alamat',
  'tanggal_bergabung',
  'status',
];
export const PROFILE_ACCOUNT_COLUMNS = PROFILE_ACCOUNT_FIELDS.join(', ');

export const PROFILE_PAYMENT_LABEL = {
  nama_bank: 'Nama bank',
  nomor_rekening: 'Nomor rekening',
  nama_pemilik_rekening: 'Nama pemilik rekening',
  npwp_nik: 'NPWP/NIK',
};

// Batas panjang disamakan dengan modul payroll (nama bank 50, nama rekening 100).
export const PROFILE_TEXT_MAX = { nama_bank: 50, nama_pemilik_rekening: 100 };

function terisi(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// Kolom wajib yang masih kosong pada `row` (objek dengan kolom pembayaran).
// Berisi NAMA kolom saja, tidak pernah nilainya.
export function kolomProfilKosong(row) {
  return PROFILE_REQUIRED_FIELDS.filter((key) => !terisi(row?.[key]));
}

// "Profil lengkap" = semua kolom wajib terisi.
export function isProfileComplete(row) {
  return kolomProfilKosong(row).length === 0;
}

const NAMA_BANK_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,&()/'’-]*$/u;
const NAMA_PEMILIK_RE = /^[\p{L}][\p{L} .,'’-]*$/u;
const REKENING_RE = /^[\d\s-]+$/;
const NPWP_NIK_RE = /^[\d.\-\s]+$/;

function hanyaDigit(text) {
  return text.replace(/\D/g, '');
}

// Validator per kolom. Menerima teks yang sudah di-trim dan tidak kosong; return
// { error } atau { value } (sudah dinormalisasi). Pesan error TIDAK memuat nilai.
const VALIDATOR = {
  nama_bank(text) {
    const value = text.replace(/\s+/g, ' ');
    if (value.length < 2 || value.length > PROFILE_TEXT_MAX.nama_bank || !NAMA_BANK_RE.test(value)) {
      return {
        error: `Nama bank harus 2–${PROFILE_TEXT_MAX.nama_bank} karakter dan hanya berisi huruf, angka, serta tanda baca umum.`,
      };
    }
    return { value };
  },
  // Disimpan sebagai angka saja (spasi/strip pemisah dibuang). Aturan 5–25 digit
  // disamakan dengan modul payroll.
  nomor_rekening(text) {
    const digits = hanyaDigit(text);
    if (text.length > 40 || !REKENING_RE.test(text) || digits.length < 5 || digits.length > 25) {
      return { error: 'Nomor rekening harus berupa angka 5–25 digit (spasi dan strip boleh).' };
    }
    return { value: digits };
  },
  nama_pemilik_rekening(text) {
    const value = text.replace(/\s+/g, ' ');
    if (value.length < 2 || value.length > PROFILE_TEXT_MAX.nama_pemilik_rekening || !NAMA_PEMILIK_RE.test(value)) {
      return {
        error: `Nama pemilik rekening harus 2–${PROFILE_TEXT_MAX.nama_pemilik_rekening} karakter dan hanya berisi huruf, spasi, serta tanda baca nama.`,
      };
    }
    return { value };
  },
  // NPWP (15 digit format lama, 16 digit format baru) atau NIK (16 digit). Disimpan
  // sebagai angka saja (titik, strip, spasi dibuang).
  npwp_nik(text) {
    const digits = hanyaDigit(text);
    if (text.length > 30 || !NPWP_NIK_RE.test(text) || (digits.length !== 15 && digits.length !== 16)) {
      return { error: 'NPWP/NIK harus 15 atau 16 digit angka (titik, strip, dan spasi boleh).' };
    }
    return { value: digits };
  },
};

// Validasi + normalisasi body PATCH Profil Saya. Dipakai di browser (pesan cepat) dan
// di server (penjaga sebenarnya).
//   input : objek yang HANYA boleh memuat kolom pembayaran. Kolom yang tidak dikirim
//           tidak diubah; teks kosong (atau null) mengosongkan kolom itu.
// Return { error } atau { values } (hanya kolom yang dikirim; kosong -> null).
// Pesan error tidak pernah memuat nilai yang dikirim.
export function validatePaymentInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Data yang dikirim tidak valid.' };
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !PROFILE_PAYMENT_FIELDS.includes(key))) {
    return { error: 'Hanya data pembayaran yang dapat diubah dari Profil Saya.' };
  }
  if (keys.length === 0) return { error: 'Tidak ada data pembayaran yang dikirim.' };

  const values = {};
  for (const key of keys) {
    const raw = input[key];
    if (raw !== null && typeof raw !== 'string') {
      return { error: `${PROFILE_PAYMENT_LABEL[key]} harus berupa teks.` };
    }
    const text = raw === null ? '' : raw.trim();
    if (text === '') {
      values[key] = null;
      continue;
    }
    const hasil = VALIDATOR[key](text);
    if (hasil.error) return { error: hasil.error };
    values[key] = hasil.value;
  }
  return { values };
}

// ---------------------------------------------------------------------------
// SERVER ONLY (butuh client service role dari pemanggil)
// ---------------------------------------------------------------------------

// Pesan ramah untuk error database yang menyentuh kolom sensitif. Hanya `code` dan
// `message` yang diteruskan ke friendlyError (yang mencatatnya ke console); `details`
// dan `hint` sengaja dibuang karena dapat memuat nilai baris.
export function pesanGalatProfil(error, fallback, context) {
  return friendlyError(error == null ? null : { code: error.code, message: error.message }, fallback, { context });
}

// Bentuk aman untuk mencatat exception tak terduga (tanpa pesan/detail yang bisa
// memuat nilai).
export function ringkasGalat(error) {
  return { name: error?.name, code: error?.code };
}

// Kelengkapan profil Freelancer dari database. Membaca kolom pembayaran dengan
// service role, mengembalikan HANYA indikator: { lengkap, kosong } (kosong = nama
// kolom wajib yang belum terisi), tidak pernah nilainya. Dipakai respons admin dan
// gate akses (FRE-TOOL-07). Freelancer tidak ditemukan -> { lengkap: false,
// kosong: seluruh kolom wajib }. Gagal membaca -> melempar Error dengan pesan ramah
// (error aslinya sudah dicatat tanpa nilai).
export async function muatKelengkapanProfil(admin, freelancerId) {
  const { data, error } = await admin
    .from('freelancers')
    .select(PROFILE_PAYMENT_COLUMNS)
    .eq('id', freelancerId)
    .maybeSingle();
  if (error) {
    throw new Error(pesanGalatProfil(error, 'Gagal memuat kelengkapan profil.', 'Muat kelengkapan profil Freelancer'));
  }
  const kosong = kolomProfilKosong(data);
  return { lengkap: kosong.length === 0, kosong };
}
