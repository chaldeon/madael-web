import { normalizeWaNumber } from '@/lib/candidateMessages';

// Deteksi dasar "kandidat yang sama melamar berkali-kali": lamaran dianggap
// terkait kalau email ATAU nomor teleponnya sama setelah dinormalisasi.
// Ini petunjuk untuk admin, bukan bukti — nomor/email bisa dipakai bersama.
//
// Dihitung dari daftar lamaran yang sudah dimuat halaman, jadi otomatis
// mengikuti cakupan akses: reviewer terbatas hanya melihat kecocokan di antara
// lowongan yang memang di-assign ke dia.

export function normalizeEmailKey(raw) {
  const email = String(raw ?? '').trim().toLowerCase();
  return email.includes('@') ? email : null;
}

// Telepon diisi bebas (0812-3456-7890, +62 812..., 812...). Samakan ke format
// digit berawalan 62. Nomor terlalu pendek atau angka berulang ("0000000000")
// diabaikan supaya isian asal-asalan tidak menyatukan orang yang berbeda.
export function normalizePhoneKey(raw) {
  const wa = normalizeWaNumber(raw);
  if (wa) return wa;

  // Bukan seluler Indonesia (mis. telepon rumah): tetap bisa dicocokkan.
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 9 || /^(\d)\1+$/.test(digits)) return null;
  if (digits.startsWith('0')) digits = '62' + digits.slice(1);
  return digits;
}

function addTo(map, key, app) {
  const list = map.get(key);
  if (list) list.push(app);
  else map.set(key, [app]);
}

// Return Map<applicationId, Array<{ id, jobId, jobTitle, createdAt, status,
// matchedBy: ('email'|'telepon')[], sameJob }>> — hanya berisi lamaran yang
// punya kecocokan, urut dari yang terbaru.
export function findDuplicateApplications(applications) {
  const byEmail = new Map();
  const byPhone = new Map();
  const keysById = new Map();

  for (const app of applications) {
    const email = normalizeEmailKey(app.email);
    const phone = normalizePhoneKey(app.telepon);
    keysById.set(app.id, { email, phone });
    if (email) addTo(byEmail, email, app);
    if (phone) addTo(byPhone, phone, app);
  }

  const result = new Map();
  for (const app of applications) {
    const { email, phone } = keysById.get(app.id);
    const related = new Map(); // id lamaran lain -> { app, matchedBy }

    const collect = (list, field) => {
      for (const other of list || []) {
        if (other.id === app.id) continue;
        const entry = related.get(other.id) || { app: other, matchedBy: [] };
        entry.matchedBy.push(field);
        related.set(other.id, entry);
      }
    };
    if (email) collect(byEmail.get(email), 'email');
    if (phone) collect(byPhone.get(phone), 'telepon');

    if (related.size === 0) continue;

    const matches = Array.from(related.values())
      .map(({ app: other, matchedBy }) => ({
        id: other.id,
        jobId: other.job_id || null,
        jobTitle: other.job_listings?.title || 'CV Umum',
        createdAt: other.created_at,
        status: other.status,
        matchedBy,
        sameJob: Boolean(app.job_id) && app.job_id === other.job_id,
      }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    result.set(app.id, matches);
  }
  return result;
}
