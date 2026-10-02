// Proteksi spam dasar untuk form publik (saat ini: /api/apply).
// Murni JS tanpa env/API server, jadi aman di-import dari client maupun server.

// Nama field honeypot. Manusia tidak melihat field ini (disembunyikan lewat CSS
// di JobApplyForm); bot yang mengisi semua input akan mengisinya. Dipakai di
// client (nama input) dan server (pengecekan) supaya tidak bisa beda.
// Sengaja bukan nama yang diisi otomatis oleh browser (mis. "website", "url").
export const HONEYPOT_FIELD = 'company_url';

// Batas lamaran per IP. Cukup longgar karena banyak pengguna seluler di
// Indonesia berbagi satu IP publik (CGNAT), begitu juga kantor/kampus.
export const APPLY_RATE_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 }; // 10 per jam

// Rate limiter sliding-window di memori proses.
// KETERBATASAN: state hidup per instance server. Di hosting serverless (mis.
// Vercel) tiap instance punya hitungan sendiri dan hilang saat cold start,
// jadi ini pengaman best-effort terhadap spam sederhana, bukan batas ketat.
// Untuk batas yang pasti, pindahkan ke store bersama (mis. Redis/Upstash).
const buckets = new Map(); // key -> { hits: number[], expires: number }
const MAX_KEYS = 5000;

function prune(now) {
  if (buckets.size <= MAX_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.expires <= now) buckets.delete(key);
  }
  // Masih terlalu besar (semua masih aktif): buang yang paling lama masuk.
  while (buckets.size > MAX_KEYS) {
    buckets.delete(buckets.keys().next().value);
  }
}

// Catat satu percobaan untuk `key`. Return { ok: true } kalau masih dalam batas,
// atau { ok: false, retryAfterSec } kalau sudah melewati batas.
export function rateLimit(key, { limit, windowMs }) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (buckets.get(key)?.hits || []).filter((t) => t > cutoff);

  if (hits.length >= limit) {
    buckets.set(key, { hits, expires: hits[hits.length - 1] + windowMs });
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)),
    };
  }

  hits.push(now);
  // delete dulu supaya key yang aktif pindah ke urutan paling baru di Map.
  buckets.delete(key);
  buckets.set(key, { hits, expires: now + windowMs });
  prune(now);
  return { ok: true };
}

// IP klien dari header proxy. Return null kalau tidak ada — pemanggil sebaiknya
// melewati rate limit daripada menaruh semua pengunjung ke satu bucket "unknown".
// Catatan: header ini hanya bisa dipercaya kalau server berada di belakang
// proxy/CDN yang mengisinya (Vercel, nginx, Cloudflare, dll).
export function getClientIp(request) {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return null;
}
