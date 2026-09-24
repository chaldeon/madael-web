import { createHmac, timingSafeEqual } from 'node:crypto';

// Token konfirmasi absensi (server only). Mengikat layar review dengan tombol
// "Konfirmasi & Simpan":
//
//   1. /api/attendance/clock/preview menghitung semuanya di server (jam, telat,
//      geofence, skor wajah) lalu menandatangani hasilnya jadi token ini.
//   2. /api/attendance/clock/confirm hanya menerima token yang tanda tangannya
//      valid dan belum kedaluwarsa, lalu menyimpan PERSIS hasil itu.
//
// Akibatnya: jam yang dicatat = jam saat foto diambil (bukan saat tombol
// konfirmasi ditekan), dan browser tidak bisa mengarang hasil geofence/wajah/jam
// — sama ketatnya dengan /api/attendance/clock yang menghitung semuanya di server.

export const CONFIRM_TTL_MS = 5 * 60 * 1000; // 5 menit untuk meninjau layar review
const VERSION = 1;

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

// Kunci tanda tangan: ATTENDANCE_CONFIRM_SECRET kalau diset; kalau tidak,
// diturunkan dari SUPABASE_SERVICE_ROLE_KEY (sudah rahasia & server-only) dengan
// label khusus supaya kuncinya tidak sama dengan service key itu sendiri.
function signingKey() {
  const explicit = process.env.ATTENDANCE_CONFIRM_SECRET;
  if (explicit) return explicit;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!service) {
    throw new Error('ATTENDANCE_CONFIRM_SECRET atau SUPABASE_SERVICE_ROLE_KEY belum diset.');
  }
  return createHmac('sha256', service).update('madael:attendance-confirm:v1').digest();
}

function sign(body) {
  return createHmac('sha256', signingKey()).update(body).digest('base64url');
}

// payload: object bebas (JSON). Ditambah v + exp otomatis.
export function signConfirmToken(payload, { now = Date.now(), ttlMs = CONFIRM_TTL_MS } = {}) {
  const full = { ...payload, v: VERSION, exp: now + ttlMs };
  const body = b64url(JSON.stringify(full));
  return { token: `${body}.${sign(body)}`, expiresAt: full.exp };
}

// Return { ok: true, payload } | { ok: false, reason: 'invalid' | 'expired' }
export function verifyConfirmToken(token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || token.length > 4096) return { ok: false, reason: 'invalid' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'invalid' };

  const [body, sig] = parts;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'invalid' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!payload || payload.v !== VERSION || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'invalid' };
  }
  if (now > payload.exp) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}