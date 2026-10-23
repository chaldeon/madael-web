// Validasi input lokasi kerja (work_locations) untuk geofence absensi.
// Fungsi murni (tanpa import server) — dipakai route API sebagai sumber
// kebenaran, dan form di browser hanya untuk pesan cepat sebelum kirim.

export const LOKASI_NAMA_MIN = 2;
export const LOKASI_NAMA_MAX = 100;
export const LOKASI_RADIUS_MIN = 10;
export const LOKASI_RADIUS_MAX = 5000;

// Terima number atau string angka murni. "12abc", "" dan null ditolak
// (parseFloat("12abc") lolos jadi 12, Number("") jadi 0 — keduanya bahaya).
function parseAngka(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const trimmed = value.trim();
  if (trimmed === '') return NaN;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : NaN;
}

const bulat6 = (n) => Math.round(n * 1e6) / 1e6;

// input   : { nama, latitude, longitude, radius_meter, aktif }
// partial : true = hanya field yang dikirim yang divalidasi (untuk PATCH)
// Return  : { ok: true, value } (hanya field yang diizinkan) atau { ok: false, error }
export function validateLokasiInput(input, { partial = false } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(src, key) && src[key] !== undefined;
  const value = {};

  if (!partial || has('nama')) {
    if (typeof src.nama !== 'string') return { ok: false, error: 'Nama lokasi wajib diisi.' };
    const nama = src.nama.replace(/\s+/g, ' ').trim();
    if (nama.length < LOKASI_NAMA_MIN) {
      return { ok: false, error: `Nama lokasi minimal ${LOKASI_NAMA_MIN} karakter.` };
    }
    if (nama.length > LOKASI_NAMA_MAX) {
      return { ok: false, error: `Nama lokasi maksimal ${LOKASI_NAMA_MAX} karakter.` };
    }
    value.nama = nama;
  }

  if (!partial || has('latitude')) {
    const lat = parseAngka(src.latitude);
    if (Number.isNaN(lat)) return { ok: false, error: 'Latitude harus berupa angka.' };
    if (lat < -90 || lat > 90) return { ok: false, error: 'Latitude harus antara -90 dan 90.' };
    value.latitude = bulat6(lat);
  }

  if (!partial || has('longitude')) {
    const lng = parseAngka(src.longitude);
    if (Number.isNaN(lng)) return { ok: false, error: 'Longitude harus berupa angka.' };
    if (lng < -180 || lng > 180) return { ok: false, error: 'Longitude harus antara -180 dan 180.' };
    value.longitude = bulat6(lng);
  }

  // Titik (0, 0) di tengah laut hampir pasti default yang lupa diisi.
  const latSet = 'latitude' in value;
  const lngSet = 'longitude' in value;
  if (latSet && lngSet && value.latitude === 0 && value.longitude === 0) {
    return { ok: false, error: 'Koordinat 0, 0 tidak valid. Isi koordinat lokasi yang sebenarnya.' };
  }

  if (!partial || has('radius_meter')) {
    const radius = parseAngka(src.radius_meter);
    if (Number.isNaN(radius) || !Number.isInteger(radius)) {
      return { ok: false, error: 'Radius harus berupa bilangan bulat (meter).' };
    }
    if (radius < LOKASI_RADIUS_MIN || radius > LOKASI_RADIUS_MAX) {
      return {
        ok: false,
        error: `Radius harus antara ${LOKASI_RADIUS_MIN} dan ${LOKASI_RADIUS_MAX} meter.`,
      };
    }
    value.radius_meter = radius;
  }

  if (has('aktif')) {
    if (typeof src.aktif !== 'boolean') return { ok: false, error: 'Status aktif tidak valid.' };
    value.aktif = src.aktif;
  } else if (!partial) {
    value.aktif = true;
  }

  if (partial && Object.keys(value).length === 0) {
    return { ok: false, error: 'Tidak ada perubahan yang dikirim.' };
  }
  return { ok: true, value };
}

// id lokasi/karyawan dari URL atau body: string pendek tanpa karakter aneh.
export function isIdValid(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[A-Za-z0-9_-]+$/.test(id);
}
