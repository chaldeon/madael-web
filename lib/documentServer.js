import { todayJakarta } from '@/lib/serverTime';

// SERVER ONLY — validasi body pembuatan dokumen & invoice (POST /api/documents,
// POST /api/invoices) serta perubahan status/isi (PATCH /api/documents/[id],
// PATCH /api/invoices/[id]/status). Sebelumnya browser menulis langsung ke
// tabel dengan validasi hanya di form.

export const DOKUMEN_KODE_VALID = ['PRO', 'QUO', 'PROQUO', 'AGR', 'ADM'];

const MAX_JUDUL = 200;
const MAX_CATATAN = 2000;
const MAX_NOMOR_MANUAL = 100;
const MAX_CONTENT_CHARS = 200_000;
export const MAX_NOMINAL_INVOICE = 1_000_000_000_000;

export const INVOICE_STATUS_VALID = ['draft', 'terkirim', 'lunas'];
export const DOKUMEN_STATUS_VALID = ['Draft', 'Final', 'Terkirim', 'Ditandatangani'];

// Status invoice yang sudah lunas tidak boleh kembali ke 'draft' (draft = belum
// pernah ditagihkan). Mundur ke 'terkirim' tetap boleh supaya salah klik
// "Lunas" bisa dibetulkan; setiap perubahan tercatat di activity log.
// Return pesan error, atau null kalau transisi boleh.
export function cekTransisiInvoice(dari, ke) {
  if (!INVOICE_STATUS_VALID.includes(ke)) {
    return `Status invoice tidak valid. Harus salah satu dari: ${INVOICE_STATUS_VALID.join(', ')}`;
  }
  if (dari === ke) return 'Status invoice sudah sama.';
  if (dari === 'lunas' && ke === 'draft') {
    return 'Invoice yang sudah lunas tidak bisa dikembalikan ke Draft. Ubah ke Terkirim bila status Lunas keliru.';
  }
  return null;
}

// Dokumen yang sudah 'Ditandatangani' hanya boleh diubah statusnya oleh
// superadmin (mencegah dokumen resmi diturunkan statusnya tanpa wewenang).
// Perpindahan lain tetap bebas seperti sebelumnya. Return pesan error / null.
export function cekTransisiDokumen(dari, ke, { isSuperadmin }) {
  if (!DOKUMEN_STATUS_VALID.includes(ke)) {
    return `Status dokumen tidak valid. Harus salah satu dari: ${DOKUMEN_STATUS_VALID.join(', ')}`;
  }
  if (dari === ke) return 'Status dokumen sudah sama.';
  if (dari === 'Ditandatangani' && !isSuperadmin) {
    return 'Status dokumen yang sudah Ditandatangani hanya bisa diubah oleh superadmin.';
  }
  return null;
}

// 'YYYY-MM-DD' yang benar-benar ada di kalender; kosong -> hari ini (Jakarta).
function parseTanggal(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: todayJakarta() };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false };
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { ok: false };
  }
  return { ok: true, value };
}

function parseCatatan(value) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.trim();
  if (trimmed.length > MAX_CATATAN) return { ok: false };
  return { ok: true, value: trimmed || null };
}

function parseClientId(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  return { ok: true, value: value.trim() };
}

// Body dokumen baru -> { values } atau { error }. created_by dan nomor_surat
// TIDAK diterima dari klien (diisi server).
export function validateDokumenBaru(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Data dokumen tidak valid.' };
  }
  if (!DOKUMEN_KODE_VALID.includes(body.kode_jenis)) {
    return { error: `Jenis dokumen tidak valid. Harus salah satu dari: ${DOKUMEN_KODE_VALID.join(', ')}` };
  }
  const judul = typeof body.judul === 'string' ? body.judul.trim() : '';
  if (!judul) return { error: 'Judul dokumen wajib diisi.' };
  if (judul.length > MAX_JUDUL) return { error: `Judul dokumen maksimal ${MAX_JUDUL} karakter.` };

  const content = body.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { error: 'Isi dokumen tidak valid.' };
  }
  if (typeof content.perihal !== 'string' || !content.perihal.trim()) {
    return { error: 'Perihal wajib diisi.' };
  }
  let ukuran = 0;
  try {
    ukuran = JSON.stringify(content).length;
  } catch {
    return { error: 'Isi dokumen tidak valid.' };
  }
  if (ukuran > MAX_CONTENT_CHARS) return { error: 'Isi dokumen terlalu besar.' };

  const tanggal = parseTanggal(body.tanggal_dokumen);
  if (!tanggal.ok) return { error: 'Tanggal dokumen tidak valid.' };
  const catatan = parseCatatan(body.catatan);
  if (!catatan.ok) return { error: `Catatan internal maksimal ${MAX_CATATAN} karakter.` };
  const client = parseClientId(body.client_id);
  if (!client.ok) return { error: 'Klien tidak valid.' };

  return {
    values: {
      kode_jenis: body.kode_jenis,
      judul,
      content,
      tanggal_dokumen: tanggal.value,
      catatan: catatan.value,
      client_id: client.value,
    },
  };
}

// Body invoice baru -> { values } atau { error }. nomor_surat kosong = minta
// nomor otomatis dari counter INV (values.nomor_manual = null).
export function validateInvoiceBaru(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Data invoice tidak valid.' };
  }
  const nominal = typeof body.nominal === 'string' && body.nominal.trim() !== '' ? Number(body.nominal) : body.nominal;
  if (typeof nominal !== 'number' || !Number.isFinite(nominal) || nominal <= 0) {
    return { error: 'Nominal wajib diisi dan harus lebih dari 0.' };
  }
  if (nominal > MAX_NOMINAL_INVOICE) return { error: 'Nominal terlalu besar.' };

  let nomorManual = null;
  if (body.nomor_surat !== undefined && body.nomor_surat !== null) {
    if (typeof body.nomor_surat !== 'string') return { error: 'Nomor surat tidak valid.' };
    const trimmed = body.nomor_surat.trim();
    if (trimmed.length > MAX_NOMOR_MANUAL) {
      return { error: `Nomor surat maksimal ${MAX_NOMOR_MANUAL} karakter.` };
    }
    nomorManual = trimmed || null;
  }

  const tanggal = parseTanggal(body.tanggal_terbit);
  if (!tanggal.ok) return { error: 'Tanggal terbit tidak valid.' };
  const catatan = parseCatatan(body.catatan);
  if (!catatan.ok) return { error: `Catatan maksimal ${MAX_CATATAN} karakter.` };
  const client = parseClientId(body.client_id);
  if (!client.ok) return { error: 'Klien tidak valid.' };

  return {
    values: {
      nominal,
      nomor_manual: nomorManual,
      tanggal_terbit: tanggal.value,
      catatan: catatan.value,
      client_id: client.value,
    },
  };
}

// Body perubahan status -> { status } atau { error }.
export function validateStatusBody(body, validList, label) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: `Data status ${label} tidak valid.` };
  }
  if (typeof body.status !== 'string' || !validList.includes(body.status)) {
    return { error: `Status ${label} tidak valid. Harus salah satu dari: ${validList.join(', ')}` };
  }
  return { status: body.status };
}

// Body edit dokumen (PATCH /api/documents/[id]) -> { values } atau { error }.
// Hanya judul, klien, isi, catatan, dan tanggal yang boleh diubah; nomor surat,
// jenis, created_by, dan status TIDAK diterima dari body ini.
// tanggal_dokumen wajib terisi agar edit tidak diam-diam mengganti ke hari ini.
export function validateDokumenEdit(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Data dokumen tidak valid.' };
  }
  const judul = typeof body.judul === 'string' ? body.judul.trim() : '';
  if (!judul) return { error: 'Judul dokumen wajib diisi.' };
  if (judul.length > MAX_JUDUL) return { error: `Judul dokumen maksimal ${MAX_JUDUL} karakter.` };

  const content = body.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { error: 'Isi dokumen tidak valid.' };
  }
  if (typeof content.perihal !== 'string' || !content.perihal.trim()) {
    return { error: 'Perihal wajib diisi.' };
  }
  let ukuran = 0;
  try {
    ukuran = JSON.stringify(content).length;
  } catch {
    return { error: 'Isi dokumen tidak valid.' };
  }
  if (ukuran > MAX_CONTENT_CHARS) return { error: 'Isi dokumen terlalu besar.' };

  if (typeof body.tanggal_dokumen !== 'string' || body.tanggal_dokumen === '') {
    return { error: 'Tanggal dokumen wajib diisi.' };
  }
  const tanggal = parseTanggal(body.tanggal_dokumen);
  if (!tanggal.ok) return { error: 'Tanggal dokumen tidak valid.' };
  const catatan = parseCatatan(body.catatan);
  if (!catatan.ok) return { error: `Catatan internal maksimal ${MAX_CATATAN} karakter.` };
  const client = parseClientId(body.client_id);
  if (!client.ok) return { error: 'Klien tidak valid.' };

  return {
    values: {
      judul,
      content,
      tanggal_dokumen: tanggal.value,
      catatan: catatan.value,
      client_id: client.value,
    },
  };
}
