// Helper murni & konfigurasi halaman Kelola Absensi Tim (app/employee/absensi/karyawan).
// Dipindah dari page.js supaya file halaman fokus ke state & tampilan.

import { hitungStatusTelat, MAX_TOLERANSI_MENIT } from '@/lib/attendanceStatus';
import { jamJakarta } from '@/lib/serverTime';

// Validasi input Toleransi (menit): bilangan bulat 0..MAX. Return angka, atau null kalau tidak valid.
export function parseToleransi(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 0 && n <= MAX_TOLERANSI_MENIT ? n : null;
}

export function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function formatJam(value) {
  return value ? value.slice(0, 5) : '—';
}

export function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

export function formatWaktu(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

// Hitung jumlah hari kerja terjadwal dalam sebuah bulan, dibatasi sampai
// tanggal cutoff (hari ini, kalau bulan yang dipilih adalah bulan berjalan).
export function countScheduledWorkdays(year, month, hariKerja, cutoffDate) {
  if (!hariKerja?.length) return 0;
  const lastDay = new Date(year, month, 0).getDate();
  const cutoff = cutoffDate < lastDay ? cutoffDate : lastDay;
  let count = 0;
  for (let day = 1; day <= cutoff; day++) {
    const date = new Date(year, month - 1, day);
    if (hariKerja.includes(HARI_LABEL[date.getDay()])) count++;
  }
  return count;
}

export function toCsvValue(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function downloadRekapCsv(rows, monthValue) {
  const header = ['Nama', 'Perusahaan', 'Total Hadir', 'Total Telat', 'Tidak Hadir'];
  const lines = [header.map(toCsvValue).join(',')];
  rows.forEach(({ emp, totalHadir, totalTelat, totalTidakHadir }) => {
    lines.push([
      emp.nama,
      emp.companies?.nama_perusahaan || '',
      totalHadir,
      totalTelat,
      totalTidakHadir === null ? '' : totalTidakHadir,
    ].map(toCsvValue).join(','));
  });
  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rekap-absensi-${monthValue}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Cocokkan jam clock-in (ISO) terhadap jadwal, untuk menentukan status telat
// saat approve koreksi (jadwal employee mungkin belum di-load di tab lain).
// Memakai aturan yang sama dengan API clock-in (jam masuk + toleransi_menit,
// waktu Jakarta), supaya koreksi yang disetujui tidak menghasilkan status
// telat yang berbeda dari clock-in biasa.
export function computeStatusTelat(afterClockInIso, schedule) {
  if (!schedule || !afterClockInIso) return false;
  return hitungStatusTelat({
    jamClockIn: jamJakarta(new Date(afterClockInIso)),
    jamMasuk: schedule.jam_masuk,
    toleransiMenit: schedule.toleransi_menit,
  });
}

export const HARI_LABEL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export const HARI_OPTIONS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

export const DEFAULT_HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];

export const EMPTY_JADWAL_FORM = { jam_masuk: '08:00', jam_pulang: '17:00', hari_kerja: DEFAULT_HARI, toleransi_menit: '0', shift_template_id: '' };

export const JADWAL_SORT_COLUMNS = {
  nama: { label: 'Nama', get: (r) => (r.emp.nama || '').toLowerCase() },
  perusahaan: { label: 'Perusahaan', get: (r) => (r.emp.companies?.nama_perusahaan || '').toLowerCase() },
  jam_masuk: { label: 'Jam Masuk', get: (r) => r.sched?.jam_masuk || '' },
  jam_pulang: { label: 'Jam Pulang', get: (r) => r.sched?.jam_pulang || '' },
  toleransi: { label: 'Toleransi', get: (r) => (r.sched ? Number(r.sched.toleransi_menit) || 0 : -1) },
  shift: { label: 'Shift', get: (r) => (r.sched ? r.shiftNama.toLowerCase() : '') },
};

export const REKAP_SORT_COLUMNS = {
  nama: { label: 'Nama', get: (r) => (r.emp.nama || '').toLowerCase() },
  perusahaan: { label: 'Perusahaan', get: (r) => (r.emp.companies?.nama_perusahaan || '').toLowerCase() },
  hadir: { label: 'Total Hadir', get: (r) => r.totalHadir },
  telat: { label: 'Total Telat', get: (r) => r.totalTelat },
  tidak_hadir: { label: 'Tidak Hadir', get: (r) => (r.totalTidakHadir === null ? -1 : r.totalTidakHadir) },
};

export const TABS = [
  { key: 'jadwal', label: 'Jadwal Kerja' },
  { key: 'shift', label: 'Template Shift' },
  { key: 'koreksi', label: 'Approval Koreksi' },
  { key: 'review', label: 'Perlu Review' },
  { key: 'lokasi', label: 'Lokasi Kerja' },
  { key: 'rekap', label: 'Rekap Bulanan' },
  { key: 'pengaturan', label: 'Pengaturan' },
];
