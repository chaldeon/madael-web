// Helper geofencing untuk modul Absensi. Menghitung jarak (meter) antara dua
// koordinat GPS (formula Haversine) dan mencocokkan posisi clock-in/out
// terhadap daftar work_locations (kantor + lokasi klien) yang aktif.
//
// Sifatnya cuma menghitung & melaporkan — TIDAK memutuskan blokir/tidaknya
// absensi. Keputusan "tetap izinkan tapi flag untuk review" ada di pemanggil
// (app/employee/absensi/page.js).

const EARTH_RADIUS_M = 6371000;

export function distanceMeter(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

// Tentukan daftar work_locations yang relevan untuk seorang karyawan saat
// checkGeofence dipanggil.
//
// - Kalau karyawan sudah di-assign ke satu/lebih lokasi tertentu (lewat tabel
//   employee_work_locations), absennya hanya dicocokkan ke lokasi-lokasi itu
//   saja — bukan ke semua kantor/klien yang terdaftar.
// - Kalau karyawan BELUM di-assign lokasi apa pun (assignedLocationIds kosong/
//   null), absen tetap harus bisa jalan seperti sebelumnya: dicocokkan ke
//   SEMUA lokasi aktif (perilaku lama), bukan diblokir.
// - Kalau lokasi yang di-assign ternyata semuanya sudah nonaktif/terhapus,
//   fallback juga ke semua lokasi aktif, supaya data assignment yang basi
//   tidak sampai menghalangi absen.
export function resolveEmployeeLocations(allLocations, assignedLocationIds) {
  const aktif = (allLocations || []).filter((l) => l.aktif);

  if (!assignedLocationIds || assignedLocationIds.length === 0) {
    return aktif;
  }

  const assignedSet = new Set(assignedLocationIds);
  const assigned = aktif.filter((l) => assignedSet.has(l.id));
  return assigned.length > 0 ? assigned : aktif;
}

// Cari lokasi kerja (dari daftar `locations` yang dioper — sudah difilter aktif
// dan, kalau perlu, sudah difilter ke lokasi assignment karyawan lewat
// resolveEmployeeLocations di atas) yang paling dekat dengan titik (lat, lng).
// Return:
//   - location: null kalau `locations` kosong
//   - jarakMeter: null kalau location null, selain itu jarak ke lokasi terdekat (dibulatkan)
//   - dalamRadius: null kalau location null (tidak bisa dicek), boolean selain itu
export function checkGeofence(lat, lng, locations) {
  const aktif = (locations || []).filter((l) => l.aktif);
  if (aktif.length === 0) {
    return { location: null, jarakMeter: null, dalamRadius: null };
  }

  let nearest = aktif[0];
  let nearestDist = distanceMeter(lat, lng, nearest.latitude, nearest.longitude);
  for (const loc of aktif.slice(1)) {
    const d = distanceMeter(lat, lng, loc.latitude, loc.longitude);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = loc;
    }
  }

  return {
    location: nearest,
    jarakMeter: Math.round(nearestDist),
    dalamRadius: nearestDist <= (nearest.radius_meter ?? 150),
  };
}