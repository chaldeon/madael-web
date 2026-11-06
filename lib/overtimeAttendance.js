// Pencocokan pengajuan lembur dengan data absensi (attendance.clock_in/out).
// Dipakai di Kelola Lembur supaya HR melihat apakah karyawan benar-benar hadir
// pada jam lembur yang diajukan sebelum menyetujui.
//
// Murni (tanpa import server/browser). Hasilnya HANYA informasi/peringatan:
// tidak ada persetujuan yang diblokir atau diubah otomatis dari sini.
//
// Waktu absensi disimpan sebagai timestamp (ISO, UTC). Semua perbandingan
// dilakukan dalam menit relatif terhadap 00:00 WIB pada tanggal lembur (WIB =
// UTC+7 tetap, tanpa DST), sehingga clock-out setelah tengah malam tetap
// terbaca benar (nilainya di atas 1440).

import { jamKeMenit } from '@/lib/overtimeRules';

const OFFSET_WIB_MENIT = 7 * 60;

// Absen dianggap cocok bila selisihnya tidak lebih dari ini (mis. clock-out
// 18:58 untuk lembur sampai 19:00 tidak perlu diberi peringatan).
export const TOLERANSI_ABSEN_MENIT = 5;

export const STATUS_ABSENSI_LEMBUR = {
  sesuai: 'sesuai',
  sebagian: 'sebagian',
  diLuar: 'di_luar',
  tanpaAbsen: 'tidak_ada_absen',
  belumPulang: 'belum_clock_out',
  janggal: 'data_janggal',
};

// Timestamp ISO -> menit sejak 00:00 WIB `tanggal` ('YYYY-MM-DD'). null bila
// timestamp tidak valid.
export function menitRelatifWIB(iso, tanggal) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  const awalHari = Date.parse(`${tanggal}T00:00:00Z`);
  if (!Number.isFinite(ms) || !Number.isFinite(awalHari)) return null;
  return Math.round((ms - awalHari) / 60000) + OFFSET_WIB_MENIT;
}

function formatJamDariMenit(menitRelatif) {
  const m = ((menitRelatif % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function jamTeks(menit) {
  return String(Number((menit / 60).toFixed(2))).replace('.', ',');
}

// lembur: { tanggal, jam_mulai, durasi_menit }
// absen : { clock_in, clock_out } (baris attendance pada tanggal lembur) atau null
//
// Return:
// {
//   status,                      // salah satu STATUS_ABSENSI_LEMBUR
//   clock_in, clock_out,         // 'HH:MM' (WIB) atau null
//   clock_out_hari_berikut,      // true bila clock-out jatuh setelah tengah malam
//   menit_dalam_jam_hadir,       // menit lembur yang berada dalam jam hadir, atau null
//   menit_di_luar_jam_hadir,     // durasi - menit_dalam_jam_hadir, atau null
//   jam_saran,                   // jam (kelipatan 0,25) yang bisa disetujui bila hanya sebagian, atau null
//   pesan,                       // teks peringatan/ringkasan (Indonesia)
// }
export function bandingkanLemburDenganAbsen(lembur, absen) {
  const hasil = {
    status: STATUS_ABSENSI_LEMBUR.tanpaAbsen,
    clock_in: null,
    clock_out: null,
    clock_out_hari_berikut: false,
    menit_dalam_jam_hadir: null,
    menit_di_luar_jam_hadir: null,
    jam_saran: null,
    pesan: 'Tidak ada clock-in pada tanggal lembur ini.',
  };

  const masuk = menitRelatifWIB(absen?.clock_in, lembur.tanggal);
  if (masuk === null) return hasil;
  hasil.clock_in = formatJamDariMenit(masuk);

  const keluar = menitRelatifWIB(absen?.clock_out, lembur.tanggal);
  if (keluar !== null) {
    hasil.clock_out = formatJamDariMenit(keluar);
    hasil.clock_out_hari_berikut = keluar >= 1440;
  }

  const mulaiMenit = jamKeMenit(lembur.jam_mulai);
  if (mulaiMenit === null || !(lembur.durasi_menit > 0)) {
    hasil.status = STATUS_ABSENSI_LEMBUR.janggal;
    hasil.pesan = 'Jam lembur tidak bisa dibandingkan dengan absensi.';
    return hasil;
  }
  const awal = mulaiMenit;
  const akhir = awal + lembur.durasi_menit;

  if (keluar === null) {
    hasil.status = STATUS_ABSENSI_LEMBUR.belumPulang;
    hasil.pesan = `Sudah clock-in ${hasil.clock_in} tetapi belum clock-out, jadi jam selesai lembur tidak bisa dicocokkan.`;
    return hasil;
  }
  if (keluar <= masuk) {
    hasil.status = STATUS_ABSENSI_LEMBUR.janggal;
    hasil.pesan = `Data absensi janggal (clock-out ${hasil.clock_out} tidak setelah clock-in ${hasil.clock_in}). Periksa data absensi.`;
    return hasil;
  }

  const rentangAbsen = `${hasil.clock_in}–${hasil.clock_out}${hasil.clock_out_hari_berikut ? ' (+1 hari)' : ''}`;

  // Menit lembur yang benar-benar berada dalam jam hadir (tanpa toleransi,
  // dipakai untuk saran jam), dan versi dengan toleransi (untuk klasifikasi).
  const dalam = Math.max(0, Math.min(akhir, keluar) - Math.max(awal, masuk));
  const dalamToleran = Math.max(
    0,
    Math.min(akhir, keluar + TOLERANSI_ABSEN_MENIT) - Math.max(awal, masuk - TOLERANSI_ABSEN_MENIT)
  );
  hasil.menit_dalam_jam_hadir = Math.min(dalam, lembur.durasi_menit);
  hasil.menit_di_luar_jam_hadir = lembur.durasi_menit - hasil.menit_dalam_jam_hadir;

  if (dalamToleran >= lembur.durasi_menit) {
    hasil.status = STATUS_ABSENSI_LEMBUR.sesuai;
    hasil.pesan = `Jam lembur berada dalam jam hadir (absen ${rentangAbsen}).`;
    return hasil;
  }

  // Toleransi hanya untuk menganggap "sesuai"; kalau tidak ada satu menit pun
  // yang benar-benar beririsan dengan jam hadir, tetap "di luar".
  if (dalam <= 0) {
    hasil.status = STATUS_ABSENSI_LEMBUR.diLuar;
    hasil.pesan = `Jam lembur seluruhnya di luar jam hadir (absen ${rentangAbsen}).`;
    return hasil;
  }

  hasil.status = STATUS_ABSENSI_LEMBUR.sebagian;
  hasil.pesan = `Hanya ${jamTeks(hasil.menit_dalam_jam_hadir)} dari ${jamTeks(lembur.durasi_menit)} jam lembur berada dalam jam hadir (absen ${rentangAbsen}).`;
  // Kelipatan 15 menit (langkah input jam disetujui = 0,25), dibulatkan ke bawah.
  const kelipatan = Math.floor(hasil.menit_dalam_jam_hadir / 15);
  hasil.jam_saran = kelipatan >= 1 ? kelipatan * 0.25 : null;
  return hasil;
}

// Hasil perlu perhatian HR (peringatan), bukan sekadar informasi.
export function perluPerhatianAbsensi(hasil) {
  return Boolean(hasil) && hasil.status !== STATUS_ABSENSI_LEMBUR.sesuai;
}
