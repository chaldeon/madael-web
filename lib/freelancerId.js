import { fetchAllRows } from '@/lib/fetchAllRows';

// Auto-generate Freelancer ID berformat FL-0001 (prefix + "-" + 4 digit).
// Mengikuti pola lib/employeeId.js: ID TIDAK disimpan sebagai counter terpisah;
// nomor berikutnya dihitung dari ID tertinggi yang sudah ada di tabel `freelancers`.
//
// Karena tanpa counter, dua pembuatan yang berjalan bersamaan bisa menghitung ID
// yang sama. Penjaganya adalah constraint UNIQUE(freelancer_code) di database
// (lihat a1_01_freelancers.sql); insertFreelancerWithRetry() di bawah menangkap
// bentrokan itu, menghitung ulang, lalu mencoba lagi.
//
// Catatan penamaan: kolom teks "FL-0001" bernama `freelancer_code`. Nama
// `freelancer_id` dipakai tabel turunan (freelancer_modules, dst.) untuk
// FOREIGN KEY ke freelancers.id (uuid), supaya keduanya tidak tertukar.
//
// Kalau suatu saat butuh ganti prefix atau jumlah digit, cukup ubah konstanta ini
// (dan pola CHECK di SQL).
export const FREELANCER_ID_PREFIX = 'FL';
export const FREELANCER_ID_PAD = 4; // 4 digit -> FL-0001 s.d. FL-9999
export const FREELANCER_ID_MAX_ATTEMPTS = 5;

const idPattern = new RegExp(`^${FREELANCER_ID_PREFIX}-(\\d+)$`, 'i');

// Cari angka tertinggi dari daftar freelancer_code yang sudah ada.
export function highestFreelancerNumber(existingCodes = []) {
  let max = 0;
  for (const raw of existingCodes) {
    if (!raw) continue;
    const match = idPattern.exec(String(raw).trim());
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

// Format satu nomor urut jadi Freelancer ID, misal 1 -> "FL-0001".
export function formatFreelancerId(n) {
  return `${FREELANCER_ID_PREFIX}-${String(n).padStart(FREELANCER_ID_PAD, '0')}`;
}

// Freelancer ID berikutnya berdasarkan daftar kode yang sudah ada + offset.
export function nextFreelancerId(existingCodes = [], offset = 0) {
  return formatFreelancerId(highestFreelancerNumber(existingCodes) + 1 + offset);
}

// Bentrok UNIQUE di Postgres = SQLSTATE 23505. `freelancer_code` dicek lewat
// nama constraint/kolom di pesan, supaya bentrok email atau auth_user_id (yang
// juga 23505) TIDAK dianggap bentrok ID dan diulang percuma.
export function isFreelancerCodeConflict(error) {
  if (!error || String(error.code) !== '23505') return false;
  const text = `${error.message || ''} ${error.details || ''}`;
  return /freelancer_code/i.test(text);
}

// SERVER ONLY — sisipkan satu baris freelancers dengan ID otomatis.
//
// admin : client service role dari createAdminClient()
// row   : data freelancer TANPA freelancer_code (diisi di sini)
// Return: { data } kalau berhasil, atau { error } (error terakhir dari Supabase,
//         atau error bentrok kalau percobaan habis).
// Seluruh baris dibaca lewat fetchAllRows supaya batas 1.000 baris PostgREST tidak
// memotong daftar kode diam-diam (itu akan menghasilkan ID yang selalu bentrok).
export async function insertFreelancerWithRetry(admin, row, { maxAttempts = FREELANCER_ID_MAX_ATTEMPTS } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data: existing, error: listError } = await fetchAllRows(
      () => admin.from('freelancers').select('id, freelancer_code')
    );
    if (listError) return { error: listError };

    const freelancer_code = nextFreelancerId((existing || []).map((f) => f.freelancer_code));
    const { data, error } = await admin
      .from('freelancers')
      .insert([{ ...row, freelancer_code }])
      .select()
      .single();

    if (!error) return { data };
    if (!isFreelancerCodeConflict(error)) return { error };
    lastError = error;
  }

  return { error: lastError };
}
