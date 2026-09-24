// Helper status keterlambatan absensi. Fungsi murni (tanpa Supabase) supaya
// dipakai bareng oleh server (app/api/attendance/*) dan semua halaman.
//
// Model data:
//   attendance.status_telat   -> hasil hitung SAAT clock-in (tidak pernah dihitung
//                                ulang untuk data lama; forward-only)
//   attendance.alasan_telat   -> alasan opsional dari karyawan
//   attendance.justified      -> null (belum ditinjau) | true | false, oleh HR
// status_telat TIDAK diubah oleh justify; badge dihitung dari kombinasi keduanya.

export const MAX_ALASAN_TELAT = 300;
export const MAX_TOLERANSI_MENIT = 120;

function toSeconds(hhmmss) {
  const [h = 0, m = 0, s = 0] = String(hhmmss).split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

// jamClockIn: 'HH:MM:SS' (waktu Jakarta), jamMasuk: 'HH:MM' atau 'HH:MM:SS'.
// Telat kalau clock-in LEBIH DARI jam masuk + toleransi (tepat di batas = tepat waktu).
// toleransiMenit 0 -> perilaku sama dengan sebelum fitur toleransi.
export function hitungStatusTelat({ jamClockIn, jamMasuk, toleransiMenit = 0 }) {
  if (!jamClockIn || !jamMasuk) return false;
  const toleransi = Math.max(0, Math.floor(Number(toleransiMenit) || 0));
  return toSeconds(jamClockIn) > toSeconds(jamMasuk) + toleransi * 60;
}

// Telat yang masih "berlaku": status_telat true dan belum di-Justified.
// Dipakai untuk total telat di rekap/statistik dan penalti payroll.
export function isTelatEfektif(row) {
  return !!row?.status_telat && row.justified !== true;
}

// Badge + catatan kecil untuk satu baris absensi.
// tone: 'green' | 'red'
export function getAttendanceStatus(row) {
  if (!row?.status_telat) {
    return { kind: 'tepat', label: 'TEPAT WAKTU', tone: 'green', note: null };
  }
  if (row.justified === true) {
    return {
      kind: 'telat_justified',
      label: 'TEPAT WAKTU (DISETUJUI)',
      tone: 'green',
      note: 'Awalnya telat, alasan disetujui HR',
    };
  }
  if (row.justified === false) {
    return { kind: 'telat', label: 'TELAT', tone: 'red', note: 'Alasan tidak disetujui HR' };
  }
  return {
    kind: 'telat',
    label: 'TELAT',
    tone: 'red',
    note: row.alasan_telat ? 'Alasan menunggu review HR' : null,
  };
}

// Menit keterlambatan dari selisih clock-in (waktu jam lokal, WIB di browser
// Indonesia) terhadap jam masuk. Logika sama persis dengan menitTelat() lama di
// payroll/payslip/runSnapshot yang sekarang dipakai bersama lewat helper ini.
function selisihMenit(clockInIso, jamMasuk) {
  if (!clockInIso || !jamMasuk) return 0;
  const d = new Date(clockInIso);
  const clockMinutes = d.getHours() * 60 + d.getMinutes();
  const [jh, jm] = jamMasuk.split(':').map(Number);
  return Math.max(0, clockMinutes - (jh * 60 + jm));
}

// Menit telat yang dipakai untuk penalti payroll.
//  - Baris LAMA (attendance.toleransi_menit null = dicatat sebelum fitur toleransi):
//    perilaku TIDAK berubah, tetap selisih clock-in vs jam masuk.
//  - Baris baru: hanya dihitung kalau telat di luar toleransi DAN belum di-Justified
//    HR; kalau ya, dihitung penuh dari jam masuk (bukan dari akhir toleransi).
// Butuh kolom attendance: clock_in, status_telat, justified, toleransi_menit.
export function menitTelatUntukPayroll(row, jamMasuk) {
  if (!row?.clock_in || !jamMasuk) return 0;
  const legacy = row.toleransi_menit === null || row.toleransi_menit === undefined;
  if (!legacy && !isTelatEfektif(row)) return 0;
  return selisihMenit(row.clock_in, jamMasuk);
}
