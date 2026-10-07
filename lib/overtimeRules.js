// Aturan lembur yang dipakai bersama oleh kalkulator publik
// (app/kalkulator-lembur), modul Lembur karyawan (app/api/overtime-requests),
// dan saran nominal di Payroll Run. Satu sumber supaya angka di ketiganya sama.
//
// Murni (tanpa import server/browser) sehingga aman dipakai di client maupun
// server.

import { HARI_LABEL, DEFAULT_HARI_KERJA } from '@/lib/leave';

export const OVERTIME_RULES = {
  biasa: [
    { upTo: 1, multiplier: 1.5 },
    { upTo: Infinity, multiplier: 2 },
  ],
  istirahat6: [
    { upTo: 7, multiplier: 2 },
    { upTo: 8, multiplier: 3 },
    { upTo: Infinity, multiplier: 4 },
  ],
  istirahat5: [
    { upTo: 8, multiplier: 2 },
    { upTo: 9, multiplier: 3 },
    { upTo: Infinity, multiplier: 4 },
  ],
  liburNasional: [
    { upTo: 5, multiplier: 2 },
    { upTo: 6, multiplier: 3 },
    { upTo: Infinity, multiplier: 4 },
  ],
};

// Batas maksimal lembur harian sesuai Pasal 26 PP No. 35 Tahun 2021
// (turunan UU Cipta Kerja / UU No. 6 Tahun 2023) — berlaku untuk hari kerja biasa.
export const MAX_JAM_LEMBUR_HARIAN = 4;
export const MAX_JAM_LEMBUR_MINGGUAN = 18;

export function getMultiplier(dayType, hour) {
  const rules = OVERTIME_RULES[dayType];
  for (const r of rules) {
    if (hour <= r.upTo) return r.multiplier;
  }
  return rules[rules.length - 1].multiplier;
}

export function computeBreakdown(dayType, jamLembur, upahPerJam) {
  const segments = [];
  let current = null;
  for (let h = 1; h <= jamLembur; h++) {
    const multiplier = getMultiplier(dayType, h);
    if (current && current.multiplier === multiplier) {
      current.count += 1;
      current.to = h;
    } else {
      if (current) segments.push(current);
      current = { from: h, to: h, count: 1, multiplier };
    }
  }
  if (current) segments.push(current);
  return segments.map((seg) => ({
    ...seg,
    ratePerJam: upahPerJam * seg.multiplier,
    subtotal: upahPerJam * seg.multiplier * seg.count,
  }));
}

// ---------------------------------------------------------------------------
// Di bawah ini khusus modul Lembur karyawan.
// ---------------------------------------------------------------------------

export const JENIS_HARI_LEMBUR = ['biasa', 'istirahat6', 'istirahat5', 'liburNasional'];

export const JENIS_HARI_LABEL = {
  biasa: 'Hari Kerja Biasa',
  istirahat6: 'Hari Istirahat (6 Hari Kerja)',
  istirahat5: 'Hari Istirahat (5 Hari Kerja)',
  liburNasional: 'Hari Libur Nasional',
};

export const STATUS_LEMBUR_LABEL = {
  pending: 'MENUNGGU',
  approved: 'DISETUJUI',
  rejected: 'DITOLAK',
  cancelled: 'DIBATALKAN',
};

export const DURASI_MIN_MENIT = 15;
export const DURASI_MAKS_MENIT = 720;
export const MAKS_ALASAN_LEMBUR = 500;
// Pengajuan boleh untuk tanggal sampai sekian hari ke belakang/depan dari hari ini (WIB).
export const RENTANG_HARI_PENGAJUAN = 14;

export function jenisHariValid(value) {
  return typeof value === 'string' && JENIS_HARI_LEMBUR.includes(value);
}

// 'HH:MM' atau 'HH:MM:SS' -> menit sejak 00:00, atau null kalau formatnya salah.
export function jamKeMenit(value) {
  if (typeof value !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Durasi dalam menit antara jam mulai dan jam selesai. Kalau jam selesai lebih
// kecil dari jam mulai, dianggap lembur melewati tengah malam. Return null
// kalau salah satu jam tidak valid; 0 kalau keduanya sama (tidak valid sebagai
// lembur — dicek validator).
export function hitungDurasiMenit(jamMulai, jamSelesai) {
  const mulai = jamKeMenit(jamMulai);
  const selesai = jamKeMenit(jamSelesai);
  if (mulai === null || selesai === null) return null;
  return selesai >= mulai ? selesai - mulai : selesai + 24 * 60 - mulai;
}

// Validasi isi pengajuan (tanpa tanggal — itu butuh "hari ini" dan dicek di API).
// Return pesan error Indonesia, atau null kalau valid.
export function validasiPengajuanLembur({ jamMulai, jamSelesai, alasan }) {
  const durasi = hitungDurasiMenit(jamMulai, jamSelesai);
  if (durasi === null) return 'Jam mulai dan jam selesai wajib diisi dengan format yang benar.';
  if (durasi < DURASI_MIN_MENIT) return `Durasi lembur minimal ${DURASI_MIN_MENIT} menit.`;
  if (durasi > DURASI_MAKS_MENIT) return `Durasi lembur maksimal ${DURASI_MAKS_MENIT / 60} jam per pengajuan.`;
  const teks = typeof alasan === 'string' ? alasan.trim() : '';
  if (!teks) return 'Alasan lembur wajib diisi.';
  if (teks.length > MAKS_ALASAN_LEMBUR) return `Alasan maksimal ${MAKS_ALASAN_LEMBUR} karakter.`;
  return null;
}

// 'YYYY-MM-DD' + n hari -> 'YYYY-MM-DD'. Pakai UTC supaya tidak terpengaruh
// zona waktu server.
export function tambahHari(tanggal, n) {
  const d = new Date(tanggal + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Selisih hari (b - a) antara dua string 'YYYY-MM-DD'.
export function selisihHari(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

// Batas satu periode 'YYYY-MM' untuk query tanggal: awal (inklusif) dan awal
// bulan berikutnya (eksklusif, pakai .lt). Menghindari hitung hari terakhir
// bulan dengan Date lokal.
export function batasPeriode(periode) {
  const [tahun, bulan] = periode.split('-').map(Number);
  const berikutnya = bulan === 12
    ? `${tahun + 1}-01-01`
    : `${tahun}-${String(bulan + 1).padStart(2, '0')}-01`;
  return { awal: `${periode}-01`, awalBulanDepan: berikutnya };
}

// Senin dan Minggu dari minggu yang memuat `tanggal` (minggu kerja Senin–Minggu).
export function rentangMingguan(tanggal) {
  const hari = new Date(tanggal + 'T00:00:00Z').getUTCDay(); // 0 = Minggu
  const geserKeSenin = hari === 0 ? -6 : 1 - hari;
  const senin = tambahHari(tanggal, geserKeSenin);
  return { senin, minggu: tambahHari(senin, 6) };
}

// Jenis hari untuk sebuah tanggal menurut jadwal kerja karyawan: hari yang
// ada di hari_kerja = 'biasa'; di luar itu hari istirahat — 'istirahat6' kalau
// jadwalnya 6 hari kerja, selain itu 'istirahat5'. Tanpa jadwal dipakai
// DEFAULT_HARI_KERJA (Senin–Jumat, 5 hari). Hari libur nasional TIDAK bisa
// dideteksi (belum ada tabelnya); admin menimpanya saat menyetujui.
export function jenisHariUntukTanggal(tanggal, hariKerja) {
  const jadwal = hariKerja?.length ? hariKerja : DEFAULT_HARI_KERJA;
  const namaHari = HARI_LABEL[new Date(tanggal + 'T00:00:00Z').getUTCDay()];
  if (jadwal.includes(namaHari)) return 'biasa';
  return jadwal.length >= 6 ? 'istirahat6' : 'istirahat5';
}

// Menit lembur yang diperhitungkan untuk batas harian/mingguan dan bentrok:
// yang sudah disetujui memakai jam_disetujui (kalau admin menguranginya),
// yang masih menunggu memakai durasi pengajuan.
export function menitEfektif(row) {
  if (row.status === 'approved' && row.jam_disetujui !== null && row.jam_disetujui !== undefined) {
    return Math.round(Number(row.jam_disetujui) * 60);
  }
  return row.durasi_menit;
}

// Interval lembur dalam menit relatif terhadap 00:00 `tanggalAcuan`. Nilai bisa
// negatif atau di atas 1440 untuk lembur yang melewati tengah malam / di hari
// lain, sehingga dua interval dari tanggal berbeda tetap bisa dibandingkan.
export function intervalMenit({ tanggal, jam_mulai, durasi_menit }, tanggalAcuan) {
  const awal = selisihHari(tanggalAcuan, tanggal) * 1440 + jamKeMenit(jam_mulai);
  return { awal, akhir: awal + durasi_menit };
}

export function intervalBentrok(a, b) {
  return a.awal < b.akhir && b.awal < a.akhir;
}

// Estimasi upah lembur untuk satu hari (satu jenis hari): jam penuh memakai
// computeBreakdown (pengali berurutan per jam), sisa pecahan jam dihitung
// proporsional dengan pengali jam berikutnya. Kalkulator publik hanya
// menerima jam bulat; pecahan muncul di sini karena admin bisa menyetujui
// jam yang lebih kecil dari durasi pengajuan (mis. 1,5 jam).
export function hitungUpahLembur(jenisHari, jam, upahPerJam) {
  if (!(jam > 0) || !(upahPerJam > 0) || !OVERTIME_RULES[jenisHari]) return 0;
  const jamPenuh = Math.floor(jam + 1e-9);
  const sisa = Math.max(0, jam - jamPenuh);
  let total = computeBreakdown(jenisHari, jamPenuh, upahPerJam).reduce((s, seg) => s + seg.subtotal, 0);
  if (sisa > 1e-9) total += upahPerJam * getMultiplier(jenisHari, jamPenuh + 1) * sisa;
  return total;
}

// Upah per jam = 1/173 × upah sebulan (gaji pokok + tunjangan tetap).
export function upahPerJamDariSebulan(upahSebulan) {
  return (Number(upahSebulan) || 0) / 173;
}
