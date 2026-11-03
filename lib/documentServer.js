import { todayJakarta } from '@/lib/serverTime';

// SERVER ONLY — validasi body pembuatan dokumen & invoice (POST /api/documents,
// POST /api/invoices). Sebelumnya browser meng-insert langsung ke tabel dengan
// validasi hanya di form.

export const DOKUMEN_KODE_VALID = ['PRO', 'QUO', 'PROQUO', 'AGR', 'ADM'];

const MAX_JUDUL = 200;
const MAX_CATATAN = 2000;
const MAX_NOMOR_MANUAL = 100;
const MAX_CONTENT_CHARS = 200_000;
export const MAX_NOMINAL_INVOICE = 1_000_000_000_000;

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
