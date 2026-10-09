// Helper istirahat (break-in / break-out) pada baris `attendance` harian.
// Fungsi murni — tidak menyentuh Supabase — jadi aman dipakai di server (API)
// maupun client (tampilan karyawan & rekap admin). Aturan status/durasi cukup
// ditulis di sini supaya semua tempat memakai definisi yang sama.
//
// Kolom (lihat db/migrations/20260930_break_attendance.sql):
//   break_start  timestamptz  jam mulai istirahat (jam server)
//   break_end    timestamptz  jam selesai istirahat (jam server)
// Satu istirahat per hari.

// Status istirahat untuk satu baris absensi hari ini.
//   'belum_masuk'  : belum clock in (atau tidak ada baris) -> istirahat belum bisa dimulai
//   'sudah_pulang' : sudah clock out -> istirahat tidak bisa dimulai/diubah lagi
//   'siap'         : sudah clock in, belum istirahat
//   'sedang'       : sedang istirahat (sudah mulai, belum selesai)
//   'selesai'      : istirahat sudah selesai
export function getBreakState(row) {
  if (!row?.clock_in) return 'belum_masuk';
  if (row.break_start && row.break_end) return 'selesai';
  if (row.break_start) return 'sedang';
  if (row.clock_out) return 'sudah_pulang';
  return 'siap';
}

// Durasi istirahat dalam menit (dibulatkan ke bawah), atau null kalau belum selesai.
// `sampai` (opsional, instant/ISO) dipakai untuk menghitung istirahat yang MASIH
// berjalan; tanpa itu, istirahat yang belum selesai mengembalikan null.
export function durasiIstirahatMenit(row, sampai = null) {
  if (!row?.break_start) return null;
  const mulai = new Date(row.break_start).getTime();
  const akhirIso = row.break_end || sampai;
  if (!akhirIso) return null;
  const akhir = new Date(akhirIso).getTime();
  if (!Number.isFinite(mulai) || !Number.isFinite(akhir) || akhir < mulai) return null;
  return Math.floor((akhir - mulai) / 60000);
}

// Durasi kerja efektif satu hari dalam menit (dibulatkan ke bawah):
// (clock out - clock in) dikurangi istirahat yang sudah selesai. null kalau
// belum clock out atau waktunya tidak valid. Istirahat yang belum selesai tidak
// dikurangkan (server menolak clock out selama istirahat, jadi ini hanya terjadi
// pada data hasil koreksi).
export function durasiKerjaMenit(row) {
  if (!row?.clock_in || !row?.clock_out) return null;
  const masuk = new Date(row.clock_in).getTime();
  const pulang = new Date(row.clock_out).getTime();
  if (!Number.isFinite(masuk) || !Number.isFinite(pulang) || pulang < masuk) return null;
  const kotor = Math.floor((pulang - masuk) / 60000);
  return Math.max(0, kotor - (durasiIstirahatMenit(row) ?? 0));
}

// 75 -> '1 jam 15 menit', 60 -> '1 jam', 8 -> '8 menit', 0 -> '< 1 menit'.
export function formatDurasi(menit) {
  if (menit == null) return '—';
  if (menit < 1) return '< 1 menit';
  const jam = Math.floor(menit / 60);
  const sisa = menit % 60;
  if (jam === 0) return `${sisa} menit`;
  if (sisa === 0) return `${jam} jam`;
  return `${jam} jam ${sisa} menit`;
}
