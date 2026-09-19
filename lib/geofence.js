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

// Cari lokasi kerja terdaftar (aktif) yang paling dekat dengan titik (lat, lng).
// Return:
//   - location: null kalau tidak ada work_locations aktif sama sekali
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
