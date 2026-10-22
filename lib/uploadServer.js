// SERVER ONLY — pemeriksaan isi file upload untuk route pengajuan karyawan
// (reimbursement, koreksi absensi).
//
// `file.type` dari FormData adalah klaim browser, bukan fakta: file apa pun bisa
// dikirim dengan Content-Type 'image/png'. Di sini tipe sebenarnya dibaca dari
// byte awal file (magic bytes), lalu dicocokkan dengan MIME yang diklaim.
import { createHash } from 'node:crypto';

// Kembalikan MIME hasil deteksi ('application/pdf' | 'image/jpeg' | 'image/png')
// atau null kalau isinya bukan salah satunya.
export function deteksiMimeDariIsi(buffer) {
  if (!buffer || buffer.length < 8) return null;
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  return null;
}

// 'image/jpg' tidak resmi tapi dikirim sebagian perangkat; samakan ke 'image/jpeg'.
function normalisasiMime(mime) {
  return mime === 'image/jpg' ? 'image/jpeg' : mime;
}

// Validasi file upload terhadap daftar MIME yang diizinkan.
//   file        : File dari formData (sudah dipastikan bukan string)
//   mimeAllowed : objek { 'image/png': 'png', ... } (nilai = ekstensi)
//   maksBytes   : batas ukuran
//   labelJenis  : mis. 'PDF, JPG, atau PNG' untuk pesan error
//   labelUkuran : mis. '4MB'
//   nama        : sebutan file di pesan error, mis. 'bukti' atau 'foto'
// Return { error } atau { buffer, mime, ext }. `mime` = hasil deteksi isi.
export async function periksaFileUpload(file, { mimeAllowed, maksBytes, labelJenis, labelUkuran, nama = 'file' }) {
  const mimeKlaim = normalisasiMime(file.type);
  if (!mimeAllowed[mimeKlaim]) {
    return { error: `Format ${nama} harus ${labelJenis}.` };
  }
  if (file.size > maksBytes) {
    return { error: `Ukuran ${nama} maksimal ${labelUkuran}.` };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeIsi = deteksiMimeDariIsi(buffer);
  if (!mimeIsi || mimeIsi !== mimeKlaim) {
    return { error: `Isi ${nama} tidak sesuai formatnya. Upload ${nama} ${labelJenis} yang asli.` };
  }
  return { buffer, mime: mimeIsi, ext: mimeAllowed[mimeIsi] };
}

// SHA-256 isi file (hex) — dipakai mendeteksi bukti yang sama diunggah dua kali.
export function hashIsiFile(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
