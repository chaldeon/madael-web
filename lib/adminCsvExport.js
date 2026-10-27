// Konfigurasi & helper ekspor CSV untuk empat halaman admin: Kelola Cuti,
// Lembur, Reimbursement, dan Slip Gaji. Dipakai bersama components/
// ExportCsvButton (mode `loadRows`): file berisi SELURUH data sesuai filter
// yang sedang aktif, bukan hanya halaman yang tampil (daftar di halaman sudah
// berhalaman, lihat lib/pagination.js).
//
// Format: tanggal ISO (YYYY-MM-DD, seperti ekspor Absensi) dan nominal rupiah
// sebagai ANGKA POLOS (tanpa "Rp"/titik ribuan) supaya bisa dijumlah di Excel.
// Kolom sensitif (rekening, NPWP, nomor BPJS, path bukti) tidak diekspor.

import { PENDAPATAN_FIELDS, POTONGAN_FIELDS, calcTHP } from '@/lib/payslipAdminConfig';
import { STATUS_REIMBURSEMENT_LABEL } from '@/lib/reimbursement';

export const CUTI_CSV_HEADERS = [
  { key: 'nama', label: 'Nama' },
  { key: 'jenis', label: 'Jenis' },
  { key: 'tanggal_mulai', label: 'Tanggal Mulai' },
  { key: 'tanggal_selesai', label: 'Tanggal Selesai' },
  { key: 'hari_kerja', label: 'Hari Kerja' },
  { key: 'status', label: 'Status' },
  { key: 'alasan', label: 'Alasan' },
  { key: 'alasan_penolakan', label: 'Alasan Penolakan' },
  { key: 'tanggal_pengajuan', label: 'Tanggal Pengajuan' },
];

export const LEMBUR_CSV_HEADERS = [
  { key: 'nama', label: 'Nama' },
  { key: 'tanggal', label: 'Tanggal' },
  { key: 'jam_mulai', label: 'Jam Mulai' },
  { key: 'jam_selesai', label: 'Jam Selesai' },
  { key: 'durasi_jam', label: 'Durasi Diajukan (jam)' },
  { key: 'jam_disetujui', label: 'Jam Disetujui' },
  { key: 'jenis_hari', label: 'Jenis Hari' },
  { key: 'alasan', label: 'Alasan' },
  { key: 'status', label: 'Status' },
  { key: 'alasan_penolakan', label: 'Alasan Penolakan' },
  { key: 'diproses_oleh', label: 'Diproses Oleh' },
];

export const REIMBURSEMENT_CSV_HEADERS = [
  { key: 'nama', label: 'Nama' },
  { key: 'tanggal_pengajuan', label: 'Tanggal Pengajuan' },
  { key: 'kategori', label: 'Kategori' },
  { key: 'jumlah', label: 'Jumlah (Rp)' },
  { key: 'deskripsi', label: 'Deskripsi' },
  { key: 'bukti', label: 'Ada Bukti' },
  { key: 'status', label: 'Status' },
  { key: 'alasan_penolakan', label: 'Alasan Penolakan' },
];

export const SLIP_CSV_HEADERS = [
  { key: 'nama', label: 'Nama Karyawan' },
  { key: 'periode', label: 'Periode' },
  { key: 'nomor_dokumen', label: 'Nomor Dokumen' },
  { key: 'status', label: 'Status' },
  ...PENDAPATAN_FIELDS.map((f) => ({ key: f.key, label: `${f.label} (Rp)` })),
  ...POTONGAN_FIELDS.map((f) => ({ key: f.key, label: `${f.label} (Rp)` })),
  { key: 'thp', label: 'Take Home Pay (Rp)' },
];

// Kolom tabel payslips yang dibaca untuk ekspor (hanya yang dipakai CSV).
export const SLIP_EXPORT_COLUMNS = [
  'id', 'periode', 'periode_label', 'nomor_dokumen', 'is_published',
  ...PENDAPATAN_FIELDS.map((f) => f.key),
  ...POTONGAN_FIELDS.map((f) => f.key),
].join(', ');

// 'YYYY-MM-DD' tanggal lokal browser — untuk akhiran nama file.
export function tanggalUntukNamaFile() {
  return new Date().toLocaleDateString('sv-SE');
}

// Ambil baris CSV dari route ekspor server. Kembalian { rows, error } sesuai
// kontrak `loadRows` di ExportCsvButton.
export async function ambilBarisEkspor(url, pesanGagal) {
  try {
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { rows: null, error: json.error || pesanGagal };
    return { rows: json.rows || [], error: null };
  } catch {
    return { rows: null, error: `${pesanGagal} Periksa koneksi internet kamu.` };
  }
}

function tanggalLokal(value) {
  return value ? new Date(value).toLocaleDateString('sv-SE') : '';
}

export function buildReimbursementCsvRows(requests, namaById) {
  return (requests || []).map((r) => ({
    nama: namaById[r.employee_id] || '',
    tanggal_pengajuan: tanggalLokal(r.created_at),
    kategori: r.kategori || '',
    jumlah: Math.round(Number(r.jumlah) || 0),
    deskripsi: r.deskripsi || '',
    bukti: r.bukti_path ? 'Ya' : 'Tidak',
    status: STATUS_REIMBURSEMENT_LABEL[r.status] || r.status || '',
    alasan_penolakan: r.rejection_reason || '',
  }));
}

export function buildSlipCsvRows(payslips) {
  return (payslips || []).map((p) => {
    // Nominal dipaksa jadi angka dulu: calcTHP memakai operator `+`, sehingga
    // nilai berupa string akan tergabung (bukan dijumlah).
    const nominal = {};
    [...PENDAPATAN_FIELDS, ...POTONGAN_FIELDS].forEach((f) => { nominal[f.key] = Number(p[f.key]) || 0; });
    return {
      nama: p.employees?.nama || '',
      periode: p.periode_label || p.periode || '',
      nomor_dokumen: p.nomor_dokumen || '',
      status: p.is_published ? 'Published' : 'Draft',
      ...nominal,
      thp: calcTHP(nominal),
    };
  });
}
