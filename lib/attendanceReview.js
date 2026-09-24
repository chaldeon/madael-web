// Helper murni (tanpa React/Supabase) untuk layar review absensi
// (components/AttendanceReviewScreen.js). Semua nilai masukan berasal dari
// `preview` yang dihitung server di /api/attendance/clock/preview.

export const MODE_LABEL = { in: 'Clock In', out: 'Clock Out' };

export function formatJarak(meter) {
  if (meter == null || !Number.isFinite(meter)) return '—';
  if (meter < 1000) return `${Math.round(meter)} m`;
  return `${(meter / 1000).toFixed(1)} km`;
}

// Selisih dua waktu ISO jadi "8 j 5 m". null kalau tidak valid / negatif.
export function formatDurasi(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalMenit = Math.floor(ms / 60000);
  const j = Math.floor(totalMenit / 60);
  const m = totalMenit % 60;
  return j > 0 ? `${j} j ${m} m` : `${m} m`;
}

// Peringatan untuk layar review. TIDAK PERNAH memblokir — hanya menginformasikan.
//   tone 'warn' : kasus yang otomatis ditangkap tab "Perlu Review" admin
//                 (di luar radius / wajah tidak cocok / wajah tidak terdeteksi)
//   tone 'info' : kondisi netral yang tidak ditangkap tab itu (tidak ada foto
//                 referensi, model wajah belum termuat, tidak ada lokasi terdaftar)
export function buildReviewWarnings(preview) {
  const out = [];
  const { wajah, lokasi } = preview;
  const REVIEW = 'Absensi tetap bisa disimpan, tapi akan masuk daftar "Perlu Review" admin.';

  if (wajah.status === 'tidak_cocok') {
    const skor = wajah.kemiripanPersen != null ? ` (kemiripan ${wajah.kemiripanPersen}%)` : '';
    out.push({ key: 'wajah', tone: 'warn', text: `Wajah tidak cocok dengan foto referensi${skor}. ${REVIEW}` });
  } else if (wajah.status === 'tidak_terdeteksi') {
    out.push({ key: 'wajah', tone: 'warn', text: `Wajah tidak terdeteksi jelas di foto. ${REVIEW}` });
  } else if (wajah.status === 'belum_dicek') {
    out.push({ key: 'wajah', tone: 'info', text: 'Verifikasi wajah belum bisa dijalankan di perangkat ini, jadi wajah belum dicek. Absensi tetap bisa disimpan.' });
  } else if (wajah.status === 'tanpa_referensi') {
    out.push({ key: 'wajah', tone: 'info', text: 'Kamu belum mendaftarkan foto referensi wajah, jadi wajah tidak diverifikasi.' });
  }

  if (lokasi.dalamRadius === false) {
    const dari = lokasi.nama ? ` dari ${lokasi.nama}` : '';
    const radius = lokasi.radiusMeter != null ? ` (radius ${lokasi.radiusMeter} m)` : '';
    out.push({ key: 'lokasi', tone: 'warn', text: `Posisimu ${formatJarak(lokasi.jarakMeter)}${dari}${radius}, di luar radius. ${REVIEW}` });
  } else if (lokasi.dalamRadius === null) {
    out.push({ key: 'lokasi', tone: 'info', text: 'Belum ada lokasi kerja terdaftar, jadi lokasi tidak dicek.' });
  }

  return out;
}

// Kotak peta (bbox) yang memuat posisi karyawan DAN lokasi kerja terdekat, dengan
// bentang minimum supaya tidak terlalu zoom-in. Urutan bbox OSM: minLon,minLat,maxLon,maxLat.
export function mapBbox(lokasi) {
  const pts = [[lokasi.lat, lokasi.lng]];
  if (lokasi.lokasiLat != null && lokasi.lokasiLng != null) pts.push([lokasi.lokasiLat, lokasi.lokasiLng]);

  const lats = pts.map((p) => p[0]);
  const lngs = pts.map((p) => p[1]);
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const MIN_HALF_LAT = 0.002; // ~220 m
  const MIN_HALF_LNG = 0.003;
  const hLat = Math.max(((Math.max(...lats) - Math.min(...lats)) / 2) * 1.4, MIN_HALF_LAT);
  const hLng = Math.max(((Math.max(...lngs) - Math.min(...lngs)) / 2) * 1.4, MIN_HALF_LNG);

  const clampLat = (v) => Math.max(-85, Math.min(85, v));
  const clampLng = (v) => Math.max(-180, Math.min(180, v));
  const f = (n) => n.toFixed(5);
  return [f(clampLng(cLng - hLng)), f(clampLat(cLat - hLat)), f(clampLng(cLng + hLng)), f(clampLat(cLat + hLat))].join(',');
}

// Embed OpenStreetMap (tanpa library/API key). Penanda = posisi karyawan.
export function osmEmbedUrl(lokasi) {
  return `https://www.openstreetmap.org/export/embed.html?bbox=${mapBbox(lokasi)}&layer=mapnik&marker=${lokasi.lat}%2C${lokasi.lng}`;
}

export function osmLinkUrl(lokasi) {
  return `https://www.openstreetmap.org/?mlat=${lokasi.lat}&mlon=${lokasi.lng}#map=17/${lokasi.lat}/${lokasi.lng}`;
}