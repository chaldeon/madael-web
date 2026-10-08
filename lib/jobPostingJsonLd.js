// Pembangun structured data schema.org `JobPosting` untuk Google for Jobs.
// Fungsi murni (tanpa akses database) supaya mudah diuji.
//
// Hanya menerima baris lowongan dengan kolom publik (lihat PUBLIC_JOB_COLUMNS
// + created_at). Gaji dibaca dari public_salary_min/max, yang NULL kalau
// show_salary = false, jadi gaji yang disembunyikan tidak pernah keluar.

import { getDeadlineDate, isJobOpen } from '@/lib/jobStatus';

// Sama dengan BASE_URL di app/sitemap.js dan metadataBase di app/layout.js.
export const SITE_URL = 'https://madael.id';
const ORG_NAME = 'Madael Consult';
const ORG_LOGO_PATH = '/logos/madael_logo_transparent.png';

// Kolom `type` di form admin adalah teks bebas (placeholder "Full-time /
// Part-time / Contract"), jadi dipetakan lewat pencocokan kata kunci, bukan
// nilai persis. Tidak dikenal → null (properti dihilangkan, bukan ditebak).
// Urutan pengecekan penting kalau satu teks memuat dua kata kunci.
export function mapEmploymentType(type) {
  const t = String(type ?? '').toLowerCase();
  if (!t.trim()) return null;
  if (/intern|magang/.test(t)) return 'INTERN';
  if (/part[\s-]?time|paruh\s*waktu/.test(t)) return 'PART_TIME';
  if (/contract|kontrak|pkwt|freelance/.test(t)) return 'CONTRACTOR';
  if (/full[\s-]?time|penuh\s*waktu/.test(t)) return 'FULL_TIME';
  return null;
}

// Deskripsi di database berupa teks polos (halaman publik merendernya dengan
// whitespace-pre-line). Google mengharapkan HTML, jadi karakter HTML di-escape
// dulu, baru baris baru diubah jadi <br>.
export function descriptionToHtml(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function buildBaseSalary(min, max) {
  const lo = Number(min) > 0 ? Number(min) : 0;
  const hi = Number(max) > 0 ? Number(max) : 0;
  if (!lo && !hi) return null;

  const value = { '@type': 'QuantitativeValue', unitText: 'MONTH' };
  if (lo && hi && lo !== hi) {
    value.minValue = Math.min(lo, hi);
    value.maxValue = Math.max(lo, hi);
  } else {
    value.value = lo || hi;
  }
  return { '@type': 'MonetaryAmount', currency: 'IDR', value };
}

// Kembalikan objek JSON-LD, atau null kalau lowongan tidak boleh diberi
// structured data (tutup/tidak ada, atau deskripsi kosong).
//
// `job` berasal dari query yang sudah memfilter is_active = true, jadi flag itu
// diisi eksplisit untuk isJobOpen; yang dicek di sini adalah deadline-nya.
export function buildJobPostingJsonLd(job, { today } = {}) {
  if (!job) return null;
  if (!isJobOpen({ ...job, is_active: true }, today)) return null;

  const description = descriptionToHtml(job.description);
  if (!description) return null;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description,
  };

  if (job.created_at) {
    const posted = new Date(job.created_at);
    if (!Number.isNaN(posted.getTime())) ld.datePosted = posted.toISOString();
  }

  // closes_at bertipe date; hari deadline masih terbuka sampai 23:59 WIB
  // (lihat lib/jobStatus.js), jadi validThrough = akhir hari itu di WIB.
  const deadline = getDeadlineDate(job);
  if (deadline) ld.validThrough = `${deadline}T23:59:59+07:00`;

  ld.hiringOrganization = {
    '@type': 'Organization',
    name: ORG_NAME,
    sameAs: SITE_URL,
    logo: `${SITE_URL}${ORG_LOGO_PATH}`,
  };

  const city = String(job.location ?? '').trim();
  if (city) {
    ld.jobLocation = {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: city, addressCountry: 'ID' },
    };
  }

  const employmentType = mapEmploymentType(job.type);
  if (employmentType) ld.employmentType = employmentType;

  ld.directApply = true;

  if (job.work_mode === 'remote') {
    ld.jobLocationType = 'TELECOMMUTE';
    ld.applicantLocationRequirements = { '@type': 'Country', name: 'ID' };
  }

  const baseSalary = buildBaseSalary(job.public_salary_min, job.public_salary_max);
  if (baseSalary) ld.baseSalary = baseSalary;

  return ld;
}

// Serialisasi aman untuk ditaruh di dalam <script type="application/ld+json">.
// JSON.stringify tidak meng-escape "<", sehingga isi database seperti
// "</script><script>..." bisa menutup tag dan menyuntikkan skrip. Mengganti
// "<" jadi \u003c tetap JSON valid dan terbaca sama oleh parser.
export function serializeJsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}
