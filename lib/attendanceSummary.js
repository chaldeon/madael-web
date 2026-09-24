// Helper ringkasan absensi bulanan untuk halaman "Absensi Saya"
// (app/employee/absensi/page.js). Semua fungsi murni — tidak menyentuh
// Supabase — supaya mudah dites dan dipakai ulang.
//
// Aturan hitung dibuat searah dengan rekap admin
// (app/employee/absensi/rekap/page.js), dengan dua perbedaan yang disengaja:
//   1. Hari ini TIDAK dihitung "tidak hadir" (harinya belum selesai, karyawan
//      masih bisa clock in). Rekap admin menghitungnya sampai hari ini.
//   2. Hari kerja yang tertutup cuti yang sudah disetujui TIDAK dihitung
//      "tidak hadir".
// Tanggal merah / libur nasional belum dihitung (belum ada tabel libur), jadi
// hari libur nasional yang jatuh di hari kerja akan tampil sebagai tidak hadir.

import { HARI_LABEL, DEFAULT_HARI_KERJA } from '@/lib/leave';
import { isTelatEfektif } from '@/lib/attendanceStatus';

function pad(n) {
  return String(n).padStart(2, '0');
}

export function toDateStr(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 'YYYY-MM' untuk bulan berjalan (jam perangkat, sama seperti todayStr()).
export function currentMonthValue(today = new Date()) {
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
}

// Geser bulan maju/mundur. shiftMonth('2026-01', -1) -> '2025-12'.
export function shiftMonth(monthValue, delta) {
  const [year, month] = monthValue.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// Batas tanggal (string YYYY-MM-DD) untuk query gte/lte ke kolom `tanggal`.
export function monthBounds(monthValue) {
  const [year, month] = monthValue.split('-').map(Number);
  const lastDayNum = new Date(year, month, 0).getDate();
  return {
    year,
    month,
    lastDayNum,
    firstDay: `${monthValue}-01`,
    lastDay: `${monthValue}-${pad(lastDayNum)}`,
  };
}

// 'September 2026'
export function formatBulan(monthValue) {
  const [year, month] = monthValue.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
  });
}

// Ringkasan satu bulan untuk satu karyawan.
//
// - rows:      baris `attendance` milik karyawan di bulan itu
//              (butuh: tanggal, clock_in, clock_out, status_telat, justified)
// - leaves:    baris `leave_requests` berstatus approved yang beririsan
//              dengan bulan itu (butuh: tanggal_mulai, tanggal_selesai)
// - hariKerja: work_schedule.hari_kerja (mis. ['Senin', ...]) atau null
//              kalau jadwal belum diatur
// - today:     'YYYY-MM-DD' hari ini
//
// Return:
//   totalHadir, totalTelat
//   totalTidakHadir: null kalau jadwal belum diatur (tidak bisa dihitung)
//   cutiHari:        jumlah hari kerja cuti disetujui di bulan itu (termasuk
//                    yang jatuh setelah hari ini)
//   days:            daftar hari yang perlu ditampilkan, terbaru di atas.
//                    Tiap item { tanggal, kind, row } dengan kind salah satu:
//                    'tepat' | 'telat' | 'cuti' | 'tidak_hadir'
export function summarizeMonth({ monthValue, rows, leaves, hariKerja, today }) {
  const { year, month, lastDayNum } = monthBounds(monthValue);
  const rowByDate = new Map((rows || []).map((r) => [r.tanggal, r]));

  const jadwal = hariKerja?.length ? hariKerja : null;
  // Sama seperti lib/leave.js: tanpa jadwal, cuti dihitung Senin–Jumat.
  const hariKerjaCuti = jadwal || DEFAULT_HARI_KERJA;

  // Kumpulan tanggal cuti disetujui (hanya hari kerja) yang jatuh di bulan ini.
  const leaveDates = new Set();
  (leaves || []).forEach((l) => {
    if (!l.tanggal_mulai || !l.tanggal_selesai) return;
    const cursor = new Date(l.tanggal_mulai + 'T00:00:00');
    const selesai = new Date(l.tanggal_selesai + 'T00:00:00');
    while (cursor <= selesai) {
      if (
        cursor.getFullYear() === year &&
        cursor.getMonth() === month - 1 &&
        hariKerjaCuti.includes(HARI_LABEL[cursor.getDay()])
      ) {
        leaveDates.add(toDateStr(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  });

  let totalHadir = 0;
  let totalTelat = 0;
  let totalTidakHadir = jadwal ? 0 : null;
  const days = [];

  for (let day = 1; day <= lastDayNum; day++) {
    const tanggal = `${monthValue}-${pad(day)}`;
    if (tanggal > today) break; // hari yang belum terjadi tidak dihitung

    const row = rowByDate.get(tanggal);

    if (row?.clock_in) {
      totalHadir++;
      // Telat yang sudah di-Justified HR dihitung tepat waktu.
      const telat = isTelatEfektif(row);
      if (telat) totalTelat++;
      days.push({ tanggal, kind: telat ? 'telat' : 'tepat', row });
      continue;
    }

    if (leaveDates.has(tanggal)) {
      days.push({ tanggal, kind: 'cuti', row });
      continue;
    }

    if (tanggal === today) continue; // hari ini belum selesai

    if (jadwal) {
      const date = new Date(year, month - 1, day);
      if (jadwal.includes(HARI_LABEL[date.getDay()])) {
        totalTidakHadir++;
        days.push({ tanggal, kind: 'tidak_hadir', row });
      }
    }
  }

  days.reverse();

  return { totalHadir, totalTelat, totalTidakHadir, cutiHari: leaveDates.size, days };
}