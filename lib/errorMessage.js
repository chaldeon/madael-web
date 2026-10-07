// Pesan error ramah-pengguna. Aman dipakai di klien maupun server (tanpa import
// khusus-server). Tujuannya: pesan mentah Postgres/PostgREST/Auth ("duplicate key
// value violates unique constraint ...", "permission denied for table ...",
// "JWT expired") tidak sampai ke layar — selain tidak ramah bagi pengguna non-teknis,
// pesan itu membocorkan nama tabel/constraint.
//
// Pesan validasi buatan sendiri (mis. "Alasan cuti wajib diisi.") JANGAN dibungkus
// helper ini; pakai hanya untuk objek error hasil query Supabase / Auth / jaringan.

const DEFAULT_FALLBACK = 'Terjadi kesalahan. Silakan coba lagi.';

const PESAN_SESI = 'Sesi kamu sudah berakhir. Silakan login ulang.';
const PESAN_JARINGAN = 'Koneksi bermasalah. Periksa internet kamu lalu coba lagi.';

// Kode SQLSTATE (Postgres) dan kode PostgREST yang umum.
const PESAN_KODE = {
  '23505': 'Data sudah ada (duplikat).',
  '23503': 'Data masih terkait dengan data lain, sehingga tidak bisa diproses.',
  '23514': 'Data tidak memenuhi aturan validasi.',
  '22P02': 'Format data tidak valid.',
  '42501': 'Kamu tidak punya izin untuk melakukan ini.',
  PGRST116: 'Data tidak ditemukan.',
};

// Kode PostgREST untuk JWT bermasalah/kedaluwarsa.
const KODE_JWT = new Set(['PGRST301', 'PGRST303']);

const JWT_EXPIRED_RE = /jwt expired/i;
// "Load failed" = pesan fetch gagal di Safari.
const NETWORK_RE = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i;

function ambilKode(error) {
  if (!error || typeof error !== 'object' || error.code == null) return '';
  return String(error.code);
}

function ambilPesan(error) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
  return '';
}

function catat(error, context) {
  console.error(context ? `${context}:` : 'Error:', error);
}

// Nama kolom dari detail pelanggaran unique Postgres: 'Key (email)=(a@b.c) already exists.'
// Hanya nama kolom yang diambil (nilainya tidak). Dipakai opsional di rute superadmin
// supaya admin tahu kolom mana yang bentrok.
function kolomDariDetail(error) {
  const details = error && typeof error === 'object' ? error.details : null;
  if (typeof details !== 'string') return null;
  const match = details.match(/^Key \(([^)]+)\)=/);
  return match ? match[1] : null;
}

// Memetakan error ke pesan Indonesia. `fallback` dipakai untuk error yang tidak dikenal
// (juga untuk null/undefined). Error asli SELALU dicatat ke console lebih dulu.
//
// options:
//   context   — label singkat untuk log (mis. 'Simpan lowongan')
//   showField — hanya untuk rute superadmin: sertakan nama kolom pada error duplikat
export function friendlyError(error, fallback = DEFAULT_FALLBACK, options = {}) {
  if (error == null) return fallback;
  catat(error, options.context);

  const kode = ambilKode(error);
  const pesan = ambilPesan(error);

  if (KODE_JWT.has(kode) || JWT_EXPIRED_RE.test(pesan)) return PESAN_SESI;
  if (NETWORK_RE.test(pesan)) return PESAN_JARINGAN;

  if (kode === '23505' && options.showField) {
    const kolom = kolomDariDetail(error);
    if (kolom) return `Data sudah ada (duplikat) pada kolom ${kolom}.`;
  }
  if (PESAN_KODE[kode]) return PESAN_KODE[kode];

  return fallback;
}

// Seperti friendlyError, tetapi mengenali error Supabase Auth yang actionable bagi admin
// (email sudah terdaftar, format email salah, batas kirim email, dst).
export function friendlyAuthError(error, fallback = DEFAULT_FALLBACK, options = {}) {
  if (error == null) return fallback;

  const kode = ambilKode(error);
  const pesan = ambilPesan(error);

  let hasil = null;
  if (kode === 'email_exists' || kode === 'user_already_exists' || /already (been )?registered|already exists/i.test(pesan)) {
    hasil = 'Email ini sudah terdaftar sebagai akun login.';
  } else if (kode === 'email_address_invalid' || /unable to validate email|invalid email|email.*invalid/i.test(pesan)) {
    hasil = 'Format email tidak valid.';
  } else if (kode === 'over_email_send_rate_limit' || /rate limit/i.test(pesan)) {
    hasil = 'Batas pengiriman email tercapai. Tunggu beberapa saat lalu coba lagi.';
  } else if (kode === 'weak_password' || /password should be at least|weak password/i.test(pesan)) {
    hasil = 'Password terlalu lemah. Gunakan password yang lebih panjang dan sulit ditebak.';
  } else if (/error sending (invite|confirmation|recovery|magic)/i.test(pesan)) {
    hasil = 'Email undangan gagal dikirim. Periksa pengaturan email (SMTP) lalu coba lagi.';
  }

  if (hasil) {
    catat(error, options.context);
    return hasil;
  }
  return friendlyError(error, fallback, options);
}

// Untuk blok `catch`, yang bisa menangkap dua jenis error sekaligus:
//   1. Error buatan sendiri, mis. `throw new Error(json.error || '...')` dari respons
//      rute API kita — pesannya sudah ramah/Indonesia, jadi dipertahankan apa adanya.
//   2. Error asli dari Supabase/jaringan (`throw error` hasil query, `TypeError: Failed to fetch`)
//      — dipetakan lewat friendlyError.
// Pembeda: Error polos (`name === 'Error'`) tanpa `code`. PostgrestError/StorageError/
// AuthError punya `name` lain, dan jaringan gagal berupa TypeError.
export function friendlyCaught(error, fallback = DEFAULT_FALLBACK, options = {}) {
  const buatanSendiri =
    error instanceof Error && error.name === 'Error' && !error.code && !!error.message;
  if (buatanSendiri && !NETWORK_RE.test(error.message) && !JWT_EXPIRED_RE.test(error.message)) {
    return error.message;
  }
  return friendlyError(error, fallback, options);
}
