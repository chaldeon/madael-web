// Opsi & formatter field terstruktur lowongan (mode kerja, level pengalaman,
// jumlah posisi, gaji). Satu sumber supaya form admin, halaman publik, dan
// filter (nanti) memakai nilai yang sama.

import { formatRupiah } from '@/lib/format';

export const WORK_MODES = [
  { value: 'onsite', label: { id: 'Onsite', en: 'Onsite' } },
  { value: 'hybrid', label: { id: 'Hybrid', en: 'Hybrid' } },
  { value: 'remote', label: { id: 'Remote', en: 'Remote' } },
];

// Patokan kuantitatif = total tahun pengalaman kerja yang relevan dengan posisi.
// Batas dibuat tidak tumpang-tindih (bilangan bulat): 0–3, 4–7, 8+.
export const EXPERIENCE_LEVELS = [
  { value: 'entry', label: { id: 'Entry Level', en: 'Entry Level' }, years: { id: '0–3 tahun', en: '0–3 years' } },
  { value: 'mid', label: { id: 'Mid Level', en: 'Mid Level' }, years: { id: '4–7 tahun', en: '4–7 years' } },
  { value: 'senior', label: { id: 'Senior Level', en: 'Senior Level' }, years: { id: '8+ tahun', en: '8+ years' } },
];

// Kolom yang boleh dibaca halaman publik (/karir). Sengaja BUKAN select('*'):
// salary_min/salary_max tidak pernah diminta dari sisi publik. Gaji publik
// dibaca dari public_salary_min/max (generated column: NULL kalau show_salary
// = false), jadi gaji yang disembunyikan tidak ikut terkirim ke browser.
export const PUBLIC_JOB_COLUMNS = [
  'id',
  'title',
  'slug',
  'department',
  'location',
  'type',
  'description',
  'requirements',
  'closes_at',
  'questions',
  'work_mode',
  'experience_level',
  'num_positions',
  'public_salary_min',
  'public_salary_max',
].join(', ');

export function getWorkModeLabel(value, lang = 'id') {
  const found = WORK_MODES.find((m) => m.value === value);
  return found ? found.label[lang] || found.label.id : null;
}

export function getExperienceLevelLabel(value, lang = 'id', withYears = true) {
  const found = EXPERIENCE_LEVELS.find((l) => l.value === value);
  if (!found) return null;
  const label = found.label[lang] || found.label.id;
  return withYears ? `${label} (${found.years[lang] || found.years.id})` : label;
}

export function formatPositions(count, lang = 'id') {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1) return null;
  if (lang === 'en') return `${n} ${n === 1 ? 'opening' : 'openings'}`;
  return `${n} posisi`;
}

// 0 / kosong = info gaji dari client belum ada → dianggap "tidak ada gaji".
export function hasSalary(min, max) {
  return Number(min) > 0 || Number(max) > 0;
}

// Mengembalikan null kalau gaji belum terisi (0/kosong), sehingga halaman
// publik tidak pernah menampilkan "Rp 0".
export function formatSalaryRange(min, max, lang = 'id') {
  const lo = Number(min) || 0;
  const hi = Number(max) || 0;
  if (lo <= 0 && hi <= 0) return null;

  const suffix = lang === 'en' ? ' / month' : ' / bulan';
  if (lo > 0 && hi > 0) {
    return (lo === hi ? formatRupiah(lo) : `${formatRupiah(lo)} – ${formatRupiah(hi)}`) + suffix;
  }
  if (lo > 0) return (lang === 'en' ? 'From ' : 'Mulai dari ') + formatRupiah(lo) + suffix;
  return (lang === 'en' ? 'Up to ' : 'Hingga ') + formatRupiah(hi) + suffix;
}
