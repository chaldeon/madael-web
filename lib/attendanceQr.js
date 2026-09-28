import { createHmac, timingSafeEqual } from 'node:crypto';
import { QR_PREFIX } from '@/lib/attendanceQrFormat';

// QR absensi per lokasi kerja (server only). Isi QR:
//   MADAEL-ABS:v1:<lokasiId>:<qr_version>:<HMAC>
//
// - HMAC ditandatangani dengan kunci rahasia server, jadi QR tidak bisa dikarang.
// - qr_version disimpan di work_locations. "Buat ulang QR" menaikkan versi, sehingga
//   QR lama (mis. fotonya bocor) langsung tidak berlaku tanpa mengganti kunci.
// - QR sengaja TIDAK memuat waktu: bisa dicetak dan ditempel. Karena itu QR bukan bukti
//   kehadiran sendirian — server tetap menghitung GPS/geofence dan hasilnya ditandai
//   "Perlu Review" kalau di luar radius, sama seperti absen foto.

const VERSION = 'v1';

// Kunci: ATTENDANCE_QR_SECRET kalau diset; kalau tidak, diturunkan dari
// SUPABASE_SERVICE_ROLE_KEY dengan label khusus (beda dari kunci token konfirmasi).
function qrKey() {
  const explicit = process.env.ATTENDANCE_QR_SECRET;
  if (explicit) return explicit;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!service) {
    throw new Error('ATTENDANCE_QR_SECRET atau SUPABASE_SERVICE_ROLE_KEY belum diset.');
  }
  return createHmac('sha256', service).update('madael:attendance-qr:v1').digest();
}

function sign(lokasiId, version) {
  return createHmac('sha256', qrKey()).update(`${lokasiId}.${version}`).digest('base64url');
}

export function buildQrPayload(lokasiId, qrVersion) {
  return [QR_PREFIX, VERSION, lokasiId, qrVersion, sign(lokasiId, qrVersion)].join(':');
}

// Return { ok: true, lokasiId, version } | { ok: false }
export function parseQrPayload(raw) {
  if (typeof raw !== 'string' || raw.length > 200) return { ok: false };
  const parts = raw.trim().split(':');
  if (parts.length !== 5 || parts[0] !== QR_PREFIX || parts[1] !== VERSION) return { ok: false };

  const [, , lokasiId, versionStr, sig] = parts;
  const version = Number(versionStr);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(lokasiId)) return { ok: false };
  if (!Number.isInteger(version) || version < 1) return { ok: false };

  const expected = Buffer.from(sign(lokasiId, version));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false };

  return { ok: true, lokasiId, version };
}

// Cocokkan QR yang dipindai dengan daftar lokasi. Return { location } atau { fail }.
//   allLocations      : work_locations aktif
//   relevantLocations : hasil resolveEmployeeLocations (lokasi yang berlaku untuk karyawan)
export function resolveQrLocation(rawQr, allLocations, relevantLocations) {
  const parsed = parseQrPayload(rawQr);
  if (!parsed.ok) {
    return { fail: { status: 400, error: 'QR tidak valid. Pastikan yang kamu scan adalah QR absensi kantor.' } };
  }

  const loc = (allLocations || []).find((l) => String(l.id) === parsed.lokasiId);
  if (!loc || !loc.aktif || !loc.qr_enabled || loc.qr_version !== parsed.version) {
    return { fail: { status: 400, error: 'QR ini sudah tidak berlaku. Minta QR terbaru ke admin.' } };
  }

  if (!(relevantLocations || []).some((l) => String(l.id) === String(loc.id))) {
    return {
      fail: {
        status: 403,
        error: `QR "${loc.nama}" bukan untuk lokasi kerjamu. Scan QR di lokasi yang ditugaskan, atau absen pakai foto.`,
      },
    };
  }

  return { location: loc };
}
