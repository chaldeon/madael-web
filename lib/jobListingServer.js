// SERVER ONLY — validasi input, slug unik, pembanding audit, dan penyegar cache
// halaman /karir untuk API lowongan (app/api/job-listings). Dulu halaman Job
// Portal menulis langsung ke tabel `job_listings` dari browser (validasi hanya
// di form, slug unik dicek dari client, audit fire-and-forget). Sekarang semua
// tulis lewat route yang memakai service role.

import { revalidatePath } from 'next/cache';
import { WORK_MODES, EXPERIENCE_LEVELS, MAX_QUESTIONS, QUESTION_TYPE_VALUES } from '@/lib/jobListingOptions';
import { isPastDeadline } from '@/lib/jobStatus';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 120;
const TITLE_MAX = 200;
const FIELD_MAX = 150;
const LONG_TEXT_MAX = 50000;
const QUESTION_MAX = 300;
const POSITIONS_MAX = 9999;
const SALARY_MAX = 999999999999; // 12 digit, sama dengan batas input di form
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Teks opsional: kosong -> null, terlalu panjang -> error.
function teksOpsional(raw, max, label) {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== 'string') return { error: `${label} tidak valid.` };
  const t = raw.trim();
  if (!t) return { value: null };
  if (t.length > max) return { error: `${label} maksimal ${max} karakter.` };
  return { value: t };
}

// Bilangan bulat >= 0 opsional (gaji): kosong -> null.
function angkaOpsional(raw, label) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > SALARY_MAX) return { error: `${label} tidak valid.` };
  return { value: n };
}

function tanggalValid(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Merapikan & memvalidasi body untuk buat / ubah lowongan. Aturannya sama dengan
// validasi di form, ditambah batas panjang, opsi mode kerja/level, dan tipe
// pertanyaan. Slug dinormalisasi (belum dijamin unik — lihat cariSlugUnik).
//
// slugAsli : slug lowongan yang sedang diedit. Kalau slug yang dikirim persis
//            sama, slug dibiarkan apa adanya (tidak dinormalisasi) supaya
//            slug lama yang tidak baku tidak berubah diam-diam dan merusak
//            tautan publiknya.
// Return { value, slugBase } atau { error } (pesan siap tampil, dikirim sebagai 400).
export function normalizeJobListingInput(body, { slugAsli = null } = {}) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const slugKiriman = typeof body?.slug === 'string' ? body.slug : '';
  const slugTidakBerubah = Boolean(slugAsli) && slugKiriman === slugAsli;
  const slugBase = slugTidakBerubah ? slugAsli : slugify(slugKiriman);
  if (!title || !slugBase) return { error: 'Judul posisi dan slug wajib diisi.' };
  if (title.length > TITLE_MAX) return { error: `Judul posisi maksimal ${TITLE_MAX} karakter.` };
  if (!slugTidakBerubah && (slugBase.length > SLUG_MAX || !SLUG_RE.test(slugBase))) {
    return { error: 'Slug tidak valid.' };
  }

  const teks = {};
  for (const [field, label, max] of [
    ['department', 'Departemen', FIELD_MAX],
    ['client_industry', 'Client / Industri', FIELD_MAX],
    ['location', 'Lokasi', FIELD_MAX],
    ['type', 'Tipe', FIELD_MAX],
    ['description', 'Deskripsi', LONG_TEXT_MAX],
    ['requirements', 'Persyaratan', LONG_TEXT_MAX],
  ]) {
    const r = teksOpsional(body?.[field], max, label);
    if (r.error) return { error: r.error };
    teks[field] = r.value;
  }

  const modeRaw = body?.work_mode === undefined || body?.work_mode === '' ? null : body.work_mode;
  if (modeRaw !== null && !WORK_MODES.some((m) => m.value === modeRaw)) {
    return { error: 'Mode kerja tidak valid.' };
  }
  const levelRaw = body?.experience_level === undefined || body?.experience_level === '' ? null : body.experience_level;
  if (levelRaw !== null && !EXPERIENCE_LEVELS.some((l) => l.value === levelRaw)) {
    return { error: 'Level pengalaman tidak valid.' };
  }

  const positions = Number(body?.num_positions);
  if (!Number.isInteger(positions) || positions < 1 || positions > POSITIONS_MAX) {
    return { error: 'Jumlah posisi minimal 1 dan harus bilangan bulat.' };
  }

  const min = angkaOpsional(body?.salary_min, 'Gaji minimum');
  if (min.error) return { error: min.error };
  const max = angkaOpsional(body?.salary_max, 'Gaji maksimum');
  if (max.error) return { error: max.error };
  if (min.value > 0 && max.value > 0 && max.value < min.value) {
    return { error: 'Gaji maksimum tidak boleh lebih kecil dari gaji minimum.' };
  }

  let closesAt = null;
  if (body?.closes_at !== undefined && body?.closes_at !== null && body?.closes_at !== '') {
    if (typeof body.closes_at !== 'string' || !tanggalValid(body.closes_at.slice(0, 10))) {
      return { error: 'Tanggal deadline tidak valid.' };
    }
    closesAt = body.closes_at.slice(0, 10);
  }

  const rawQuestions = body?.questions === undefined || body?.questions === null ? [] : body.questions;
  if (!Array.isArray(rawQuestions)) return { error: 'Daftar pertanyaan tidak valid.' };
  if (rawQuestions.length > MAX_QUESTIONS) {
    return { error: `Maksimal ${MAX_QUESTIONS} pertanyaan untuk pelamar.` };
  }
  const questions = [];
  for (const q of rawQuestions) {
    const text = typeof q?.text === 'string' ? q.text.trim() : '';
    if (!text) return { error: 'Ada pertanyaan yang masih kosong. Isi atau hapus pertanyaan tersebut.' };
    if (text.length > QUESTION_MAX) return { error: `Pertanyaan maksimal ${QUESTION_MAX} karakter.` };
    const type = q?.type === undefined || q?.type === null || q?.type === '' ? 'text' : q.type;
    if (!QUESTION_TYPE_VALUES.includes(type)) return { error: 'Tipe pertanyaan tidak valid.' };
    questions.push({ text, type, required: q?.required === true });
  }

  return {
    slugBase,
    value: {
      title,
      department: teks.department,
      client_industry: teks.client_industry,
      location: teks.location,
      type: teks.type,
      work_mode: modeRaw,
      experience_level: levelRaw,
      num_positions: positions,
      salary_min: min.value,
      salary_max: max.value,
      show_salary: body?.show_salary === true,
      description: teks.description,
      requirements: teks.requirements,
      closes_at: closesAt,
      is_active: body?.is_active === true,
      questions,
    },
  };
}

// Slug yang belum dipakai lowongan lain (excludeId = lowongan yang sedang diedit).
// Kalau bentrok, ditambah -2, -3, dst. Dicek di server; bentrokan balapan tetap
// ditangkap constraint unik (lihat simpanDenganSlugUnik).
export async function cariSlugUnik(admin, baseSlug, excludeId = null) {
  let candidate = baseSlug;
  let n = 2;
  while (true) {
    let query = admin.from('job_listings').select('id').eq('slug', candidate);
    if (excludeId) query = query.neq('id', excludeId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return candidate;
    candidate = `${baseSlug}-${n}`;
    n += 1;
  }
}

// Insert/update dengan slug unik. Kalau dua permintaan berebut slug yang sama,
// yang kalah kena 23505 — cari slug baru dan coba lagi (maks 4 kali).
// run(slug) -> { data, error }
export async function simpanDenganSlugUnik(admin, baseSlug, excludeId, run) {
  let result;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const slug = await cariSlugUnik(admin, baseSlug, excludeId);
    result = await run(slug);
    if (!result.error || result.error.code !== '23505') break;
  }
  return result;
}

// Payload salinan lowongan: nonaktif, judul "(Copy)", deadline yang sudah lewat
// tidak ikut disalin (salinannya akan langsung tertutup otomatis).
export function buatPayloadDuplikat(job) {
  return {
    title: `${job.title} (Copy)`,
    department: job.department,
    client_industry: job.client_industry,
    location: job.location,
    type: job.type,
    work_mode: job.work_mode,
    experience_level: job.experience_level,
    num_positions: job.num_positions ?? 1,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    show_salary: !!job.show_salary,
    description: job.description,
    requirements: job.requirements,
    closes_at: isPastDeadline(job) ? null : job.closes_at,
    is_active: false,
    questions: Array.isArray(job.questions) ? job.questions : [],
  };
}

// ---- Audit log: perubahan lowongan ----
// Field pendek dicatat dengan nilai lama -> baru. Deskripsi/persyaratan/pertanyaan
// hanya ditandai "diubah" supaya detail log tidak membengkak.
const AUDIT_FIELDS = [
  'title', 'slug', 'department', 'client_industry', 'location', 'type', 'work_mode',
  'experience_level', 'num_positions', 'salary_min', 'salary_max', 'show_salary',
  'closes_at', 'is_active',
];
const AUDIT_BOOL_FIELDS = new Set(['show_salary', 'is_active']);
const AUDIT_LONG_FIELDS = ['description', 'requirements'];

export function diffListing(before, after) {
  const changes = {};
  if (!before) return changes;
  for (const f of AUDIT_FIELDS) {
    const a = AUDIT_BOOL_FIELDS.has(f) ? !!before[f] : String(before[f] ?? '');
    const b = AUDIT_BOOL_FIELDS.has(f) ? !!after[f] : String(after[f] ?? '');
    if (a !== b) {
      changes[f] = {
        dari: before[f] ?? null,
        ke: after[f] ?? null,
      };
    }
  }
  for (const f of AUDIT_LONG_FIELDS) {
    if ((before[f] || '') !== (after[f] || '')) changes[f] = 'diubah';
  }
  const qBefore = Array.isArray(before.questions) ? before.questions : [];
  const qAfter = Array.isArray(after.questions) ? after.questions : [];
  if (JSON.stringify(qBefore) !== JSON.stringify(qAfter)) {
    changes.questions = { jumlah_dari: qBefore.length, jumlah_ke: qAfter.length };
  }
  return changes;
}

// Segarkan cache halaman publik /karir dan /karir/[slug] (ISR) setelah lowongan
// berubah — kirim slug lama DAN baru kalau slug diganti. Gagal menyegarkan tidak
// boleh membatalkan aksi utama: halaman tetap menyegarkan diri sendiri sesuai
// `revalidate` di halamannya.
export function segarkanHalamanKarir(slugs = []) {
  try {
    revalidatePath('/karir');
    [...new Set(slugs.filter((s) => typeof s === 'string' && SLUG_RE.test(s)))].forEach((slug) =>
      revalidatePath(`/karir/${slug}`)
    );
  } catch (err) {
    console.error('Gagal menyegarkan halaman karir:', err);
  }
}
