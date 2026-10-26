// Klasifikasi kehadiran SATU karyawan untuk SATU hari (monitor kehadiran hari
// ini di dashboard HRIS). Fungsi murni — tanpa Supabase — supaya mudah dites
// dan dipakai ulang oleh route server maupun tampilan.
//
// Aturan dibuat searah dengan lib/attendanceSummary.js (rekap bulanan):
//   - sudah clock in            -> 'hadir' atau 'telat' (telat yang sudah
//                                  di-Justified HR dihitung tepat waktu)
//   - cuti disetujui di hari kerja -> 'cuti'
//   - belum ada jadwal kerja    -> 'tanpa_jadwal' (tidak bisa dinilai)
//   - bukan hari kerja          -> 'libur'
//   - sisanya (wajib masuk, belum clock in):
//       sudah lewat jam masuk + toleransi -> 'belum_clock_in'
//       belum lewat                        -> 'menunggu'
// Tanggal merah / libur nasional belum dihitung (belum ada tabel libur), jadi
// libur nasional di hari kerja akan tampil sebagai 'belum_clock_in'.

import { HARI_LABEL, DEFAULT_HARI_KERJA } from '@/lib/leave';
import { hitungStatusTelat, isTelatEfektif } from '@/lib/attendanceStatus';

// Modul yang boleh melihat monitor ini (superadmin lolos otomatis, kecuali modul
// EXPLICIT_ONLY). absensi_admin sendiri superadminOnly, jadi HR non-superadmin
// masuk lewat employee_list (kelola data karyawan) atau leave_request_admin
// (sudah melihat siapa yang cuti). Dipakai route server DAN dashboard supaya
// widget hanya tampil untuk yang memang boleh memuatnya.
export const KEHADIRAN_MODULES = ['absensi_admin', 'employee_list', 'leave_request_admin'];

// Urutan tampil: yang perlu ditindaklanjuti HR paling atas.
export const KEHADIRAN_KINDS = ['belum_clock_in', 'telat', 'cuti', 'menunggu', 'hadir'];

export const KEHADIRAN_LABEL = {
  belum_clock_in: 'Belum clock-in',
  telat: 'Telat',
  cuti: 'Cuti',
  menunggu: 'Belum waktunya',
  hadir: 'Hadir',
};

// Nama hari ('Senin', ...) untuk tanggal 'YYYY-MM-DD'. Dihitung lewat UTC supaya
// tidak bergeser oleh zona waktu server.
export function namaHari(tanggal) {
  return HARI_LABEL[new Date(`${tanggal}T00:00:00Z`).getUTCDay()];
}

// 'HH:MM' di waktu Jakarta untuk timestamp ISO (kolom clock_in); '—' kalau kosong.
export function jamJakartaDariIso(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

// Parameter:
//   hariIni     : nama hari ('Senin', ...) untuk tanggal hari ini
//   jamSekarang : 'HH:MM:SS' waktu Jakarta
//   schedule    : baris work_schedule (jam_masuk, hari_kerja, toleransi_menit) atau null
//   attendance  : baris attendance hari ini atau null
//   cuti        : pengajuan cuti approved yang mencakup hari ini atau null
// Return: salah satu dari KEHADIRAN_KINDS, atau 'libur' | 'tanpa_jadwal'.
export function klasifikasiKehadiran({ hariIni, jamSekarang, schedule, attendance, cuti }) {
  if (attendance?.clock_in) {
    return isTelatEfektif(attendance) ? 'telat' : 'hadir';
  }

  const jadwalHari = schedule?.hari_kerja?.length ? schedule.hari_kerja : null;
  // Sama seperti lib/leave.js: tanpa jadwal, cuti dihitung Senin–Jumat.
  const hariKerjaCuti = jadwalHari || DEFAULT_HARI_KERJA;
  if (cuti && hariKerjaCuti.includes(hariIni)) return 'cuti';

  if (!jadwalHari || !schedule?.jam_masuk) return 'tanpa_jadwal';
  if (!jadwalHari.includes(hariIni)) return 'libur';

  const lewatBatas = hitungStatusTelat({
    jamClockIn: jamSekarang,
    jamMasuk: schedule.jam_masuk,
    toleransiMenit: schedule.toleransi_menit,
  });
  return lewatBatas ? 'belum_clock_in' : 'menunggu';
}

// Hitung jumlah per kind dari daftar { kind }.
export function hitungPerKind(items) {
  const counts = { belum_clock_in: 0, telat: 0, cuti: 0, menunggu: 0, hadir: 0, libur: 0, tanpa_jadwal: 0 };
  items.forEach((i) => {
    if (counts[i.kind] !== undefined) counts[i.kind] += 1;
  });
  return counts;
}
