// Helper bersama riwayat revisi peraturan (components/peraturan/RevisiPanel.js,
// app/employee/peraturan/terhapus). Tabel dan RPC-nya ada di
// sql/20261014_peraturan_revisi.sql.
import { friendlyError } from '@/lib/errorMessage';
import { formatTanggal, formatUkuranBerkas } from '@/lib/peraturanConfig';

// Kolom isi yang ikut dipulihkan. HARUS sama dengan c_isi di fungsi SQL
// pulihkan_peraturan_revisi().
export const REVISI_KOLOM_ISI = [
  { key: 'jenis', label: 'Jenis' },
  { key: 'nomor', label: 'Nomor' },
  { key: 'tahun', label: 'Tahun' },
  { key: 'judul', label: 'Judul' },
  { key: 'tentang', label: 'Tentang' },
  { key: 'tanggal_ditetapkan', label: 'Tanggal Ditetapkan', tipe: 'tanggal' },
  { key: 'tanggal_berlaku', label: 'Tanggal Berlaku', tipe: 'tanggal' },
  { key: 'status', label: 'Status' },
  { key: 'ringkasan', label: 'Ringkasan' },
  { key: 'url_sumber', label: 'URL Sumber Resmi' },
  { key: 'url_pdf', label: 'URL Berkas PDF' },
  { key: 'topik', label: 'Topik', tipe: 'daftar' },
  { key: 'keywords', label: 'Keyword', tipe: 'daftar' },
];

// Dicatat di riwayat tetapi TIDAK dipulihkan (berkas di Drive sudah dihapus
// saat PDF diganti atau peraturan dihapus). Hanya ditampilkan di diff.
export const REVISI_KOLOM_PDF = [
  { key: 'pdf_nama', label: 'Berkas PDF unggahan', tipe: 'pdf' },
];

export const AKSI_REVISI_LABEL = {
  awal: 'Cadangan awal',
  buat: 'Dibuat',
  ubah: 'Diubah',
  hapus: 'Dihapus',
};

export const REVISI_LIST_COLUMNS =
  'id, versi, aksi, diubah_oleh, diubah_pada, sumber_revisi_id, jumlah_relasi, jumlah_pasal';
export const REVISI_LIMIT = 50;

// Nilai kolom -> teks tampilan.
export function tampilkanNilai(kolom, value) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
  if (kolom.tipe === 'tanggal') return formatTanggal(value);
  if (kolom.tipe === 'daftar') return value.join(', ');
  return String(value);
}

// Bentuk pembanding: daftar diurutkan dulu (urutan topik/keyword tidak dianggap perubahan di UI).
function bentuk(kolom, value) {
  if (value == null || value === '') return '';
  if (kolom.tipe === 'daftar') return JSON.stringify([...value].sort());
  return String(value);
}

// Selisih dua snapshot untuk kolom tertentu: [{ key, label, sebelum, sesudah }].
export function selisihSnapshot(sebelum, sesudah, kolomList = REVISI_KOLOM_ISI) {
  const a = sebelum || {};
  const b = sesudah || {};
  return kolomList
    .filter((k) => bentuk(k, a[k.key]) !== bentuk(k, b[k.key]))
    .map((k) => ({
      key: k.key,
      label: k.label,
      sebelum: tampilkanNilai(k, a[k.key]),
      sesudah: tampilkanNilai(k, b[k.key]),
    }));
}

// Ringkasan berkas PDF untuk baris info di diff, mis. "dokumen.pdf (1,2 MB)".
export function ringkasPdf(snapshot) {
  if (!snapshot?.pdf_nama) return '';
  const ukuran = formatUkuranBerkas(snapshot.pdf_ukuran);
  return ukuran ? `${snapshot.pdf_nama} (${ukuran})` : snapshot.pdf_nama;
}

// Pesan error RPC: pesan Indonesia dari fungsi SQL (SQLSTATE 'PR001') ditampilkan
// apa adanya; error lain dipetakan lewat friendlyError.
export function pesanErrorRevisi(err, fallback, context) {
  if (err?.code === 'PR001' && err.message) return err.message;
  return friendlyError(err, fallback, { context });
}

// Nama karyawan untuk daftar id: { [id]: nama }. Gagal -> objek kosong
// (nama hanya pelengkap; tampilan jatuh ke "—").
export async function muatNamaKaryawan(supabase, ids) {
  const unik = [...new Set((ids || []).filter(Boolean))];
  if (unik.length === 0) return {};
  const { data, error } = await supabase.from('employees').select('id, nama').in('id', unik);
  if (error) {
    console.error('Gagal memuat nama karyawan untuk riwayat:', error);
    return {};
  }
  return Object.fromEntries((data || []).map((e) => [e.id, e.nama]));
}
