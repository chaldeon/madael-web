// Batas ukuran upload lewat API route (dipakai client & server).
//
// 4MB, bukan 5-10MB: batas body request fungsi serverless Vercel ~4,5MB. File
// yang lebih besar ditolak platform SEBELUM sampai ke route kita, dengan respons
// non-JSON (413), sehingga pesan error dari route tidak pernah terkirim.
// Nilai yang sama dipakai modul feedback (lib/feedbackConfig.js), cuti
// (lib/leave.js) dan peraturan (lib/peraturanConfig.js).
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const UPLOAD_MAX_LABEL = '4MB';

export const PESAN_UKURAN_UPLOAD = `Ukuran file maksimal ${UPLOAD_MAX_LABEL}. Perkecil atau kompres file lalu coba lagi.`;

// Membaca respons fetch dari route upload. Mengembalikan body JSON bila sukses;
// melempar Error berpesan ramah bila gagal. Menangani dua kasus yang tidak bisa
// ditangani `await res.json()` polos:
//   - 413 dari platform (body terlalu besar) -> pesan ukuran yang jelas
//   - respons bukan JSON (mis. halaman error teks dari platform) -> pesan fallback
// Error polos ini dipertahankan apa adanya oleh friendlyCaught (lib/errorMessage.js).
export async function readUploadJson(res, fallback = 'Gagal mengupload file.') {
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 413) throw new Error(PESAN_UKURAN_UPLOAD);
  if (!res.ok) throw new Error((body && body.error) || fallback);
  if (!body) throw new Error(fallback);
  return body;
}
