// Waktu dinding (wall-clock) Asia/Jakarta (WIB, UTC+7, tanpa DST) yang aman
// dipanggil dari server.
//
// `new Date()` polos di server TIDAK bisa langsung dipakai untuk menentukan
// "tanggal hari ini" atau membandingkan jam ke jadwal kerja (jam_masuk):
// server (mis. Vercel serverless) umumnya berjalan di UTC, sedangkan seluruh
// data absensi (tanggal, jam_masuk karyawan) memakai waktu Jakarta. Tanpa
// konversi eksplisit, karyawan yang absen larut malam WIB bisa tercatat di
// tanggal yang salah, atau status telat dihitung salah beberapa jam.

const TZ = 'Asia/Jakarta';

function partsJakarta(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  fmt.formatToParts(date).forEach(({ type, value }) => { parts[type] = value; });
  return parts;
}

// 'YYYY-MM-DD' di waktu Jakarta untuk instant `date` (default: sekarang).
export function todayJakarta(date = new Date()) {
  const p = partsJakarta(date);
  return `${p.year}-${p.month}-${p.day}`;
}

// 'HH:MM:SS' di waktu Jakarta — dibandingkan sebagai string ke kolom time
// work_schedule.jam_masuk, sama seperti timeStr() di sisi client sebelumnya.
export function jamJakarta(date = new Date()) {
  const p = partsJakarta(date);
  return `${p.hour}:${p.minute}:${p.second}`;
}