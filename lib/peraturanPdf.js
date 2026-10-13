// Helper sisi klien untuk berkas PDF peraturan yang disimpan di Google Drive
// (lewat /api/peraturan/pdf). Dipakai components/peraturan/PeraturanForm.js.
import { LIMITS, formatUkuranBerkas } from '@/lib/peraturanConfig';

// Validasi berkas sebelum diunggah. Return pesan error, atau '' kalau lolos.
// Cermin dari pemeriksaan di route (route tetap penjaga akhirnya).
export async function validasiPdf(file) {
  if (!file) return 'Pilih berkas PDF terlebih dahulu.';
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) {
    return 'Format berkas harus PDF.';
  }
  if (file.size <= 0) return 'Berkas PDF kosong.';
  if (file.size > LIMITS.pdfBytes) {
    return `Ukuran PDF maksimal ${formatUkuranBerkas(LIMITS.pdfBytes)} (berkas ini ${formatUkuranBerkas(file.size)}). Untuk berkas lebih besar, isi kolom URL Berkas PDF dengan tautan.`;
  }
  const head = await file.slice(0, 5).text();
  if (head !== '%PDF-') return 'Isi berkas bukan PDF yang valid.';
  return '';
}

// Unggah ke Drive. Return { fileId, nama, ukuran }; melempar Error berpesan
// Indonesia kalau gagal.
export async function unggahPdfPeraturan(file) {
  const body = new FormData();
  body.append('file', file);
  let res;
  try {
    res = await fetch('/api/peraturan/pdf', { method: 'POST', body });
  } catch {
    throw new Error('Koneksi bermasalah saat mengunggah PDF. Periksa internet kamu lalu coba lagi.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 413) throw new Error('Berkas terlalu besar untuk diunggah.');
    throw new Error(json.error || 'Gagal mengunggah PDF.');
  }
  return json;
}

// Hapus berkas di Drive. Tidak melempar: dipanggil sebagai pembersihan setelah
// aksi utama berhasil/gagal, dan kegagalannya tidak boleh membatalkan apa pun.
// Return true kalau berkas sudah terhapus (atau memang sudah tidak ada).
export async function hapusPdfPeraturan(fileId) {
  if (!fileId) return true;
  try {
    const res = await fetch('/api/peraturan/pdf', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId }),
    });
    if (!res.ok) console.error('Gagal menghapus PDF peraturan di Drive:', res.status);
    return res.ok;
  } catch (err) {
    console.error('Gagal menghapus PDF peraturan di Drive:', err);
    return false;
  }
}
