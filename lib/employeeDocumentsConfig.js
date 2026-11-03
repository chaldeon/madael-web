// Konfigurasi dokumen pribadi karyawan (KTP, NPWP, Ijazah, Kontrak Kerja, dll).
// Dipakai client (panel) DAN server (/api/employee/[id]/documents) supaya daftar
// jenis dan aturan "kontrak" tidak bisa melenceng antara UI dan API.

export const JENIS_DOKUMEN_OPTIONS = ['KTP', 'NPWP', 'Ijazah', 'Kontrak Kerja', 'PKWT', 'Lainnya'];

// Kolom `jenis` di tabel hanya diisi nilai "bucket" lama (KTP/NPWP/Ijazah/
// Kontrak Kerja/Lainnya) supaya tetap cocok dengan data yang sudah ada.
// PKWT dicatat sebagai Kontrak Kerja di kolom itu; nama yang dipilih pengguna
// tetap tersimpan utuh di nama_dokumen.
export const JENIS_KOLOM = { PKWT: 'Kontrak Kerja' };

// Dokumen kontrak = arsip HR: karyawan boleh mengunggah salinannya, tetapi
// hanya superadmin yang boleh menghapus. Dicocokkan ke jenis DAN nama_dokumen
// supaya baris lama yang diunggah HR lewat Payroll (nama_dokumen 'PKWT') ikut.
export function isDokumenKontrak(row) {
  const pola = /^\s*(kontrak kerja|pkwt|pkwtt)\b/i;
  return [row?.jenis, row?.nama_dokumen].some((v) => typeof v === 'string' && pola.test(v));
}

export const KETERANGAN_MAX_LENGTH = 100;
