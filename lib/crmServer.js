import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { friendlyError } from '@/lib/errorMessage';

// SERVER ONLY — validasi & helper untuk route CRM (/api/crm/**). Sebelumnya
// halaman CRM menulis langsung ke tabel companies, client_activities,
// client_projects, dan crm_deals dari browser: tanpa validasi di server,
// tanpa pemeriksaan hak di server, dan tanpa activity log.
//
// Daftar pilihan yang DIPAKSA hanya stage dan tipe (keduanya dikontrol UI
// dan dipakai untuk kanban/filter). Kolom lain (industri, ukuran, jenis
// layanan, dst.) hanya dicek tipe dan panjangnya, supaya data lama dengan
// nilai di luar pilihan sekarang tetap bisa disimpan.

export const CRM_STAGES = [
  'Prospek',
  'Dikontrak',
  'Proposal Terkirim',
  'Negosiasi',
  'Closed Won',
  'Closed Lost',
  'On Hold',
];
export const CRM_TIPE_VALID = ['client', 'vendor', 'partner', 'prospect'];

const MAX_TEKS = 200;
const MAX_ALAMAT = 500;
const MAX_CATATAN = 5000;
const MAX_URL = 300;
const MAX_NILAI = 1_000_000_000_000_000;

// Hak CRM = modul 'crm' (sama dengan layout /employee/crm).
export async function requireCrmAccess(admin) {
  return requireModuleAccess(admin, ['crm']);
}

function teksOpsional(value, max, label) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${label} tidak valid.` };
  const t = value.trim();
  if (t.length > max) return { ok: false, error: `${label} maksimal ${max} karakter.` };
  return { ok: true, value: t || null };
}

function tanggalOpsional(value, label) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ok: false, error: `${label} tidak valid.` };
  }
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { ok: false, error: `${label} tidak valid.` };
  }
  return { ok: true, value };
}

function nilaiOpsional(value, label) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_NILAI) {
    return { ok: false, error: `${label} tidak valid.` };
  }
  return { ok: true, value: n };
}

function idOpsional(value, label) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || value.length > 100) return { ok: false, error: `${label} tidak valid.` };
  return { ok: true, value: value.trim() };
}

function objekBody(body, label) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: `Data ${label} tidak valid.` };
  }
  return null;
}

export function validateStageBody(body) {
  const bad = objekBody(body, 'stage');
  if (bad) return bad;
  if (typeof body.stage !== 'string' || !CRM_STAGES.includes(body.stage)) {
    return { error: `Stage tidak valid. Harus salah satu dari: ${CRM_STAGES.join(', ')}` };
  }
  return { stage: body.stage };
}

// Body tambah/edit klien -> { values } atau { error }. `withStage` hanya untuk
// tambah (edit mengganti stage lewat endpoint terpisah, sama seperti UI).
export function validateKlien(body, { withStage }) {
  const bad = objekBody(body, 'klien');
  if (bad) return bad;

  const nama = typeof body.nama_perusahaan === 'string' ? body.nama_perusahaan.trim() : '';
  if (!nama) return { error: 'Nama perusahaan wajib diisi.' };
  if (nama.length > MAX_TEKS) return { error: `Nama perusahaan maksimal ${MAX_TEKS} karakter.` };

  if (!Array.isArray(body.tipe) || body.tipe.length === 0) {
    return { error: 'Pilih minimal satu tipe perusahaan (client/vendor/partner/prospect).' };
  }
  if (!body.tipe.every((t) => CRM_TIPE_VALID.includes(t))) {
    return { error: 'Tipe perusahaan tidak valid.' };
  }
  const tipe = Array.from(new Set(body.tipe));

  const fields = [
    ['industri', MAX_TEKS, 'Industri'],
    ['ukuran', MAX_TEKS, 'Ukuran'],
    ['website', MAX_URL, 'Website'],
    ['alamat', MAX_ALAMAT, 'Alamat'],
    ['kota', MAX_TEKS, 'Kota'],
    ['pic_nama', MAX_TEKS, 'Nama PIC'],
    ['pic_jabatan', MAX_TEKS, 'Jabatan PIC'],
    ['pic_email', MAX_TEKS, 'Email PIC'],
    ['pic_telepon', MAX_TEKS, 'Telepon PIC'],
    ['catatan', MAX_CATATAN, 'Catatan'],
  ];
  const values = { nama_perusahaan: nama, tipe };
  for (const [key, max, label] of fields) {
    const r = teksOpsional(body[key], max, label);
    if (!r.ok) return { error: r.error };
    values[key] = r.value;
  }

  const assigned = idOpsional(body.assigned_to, 'PIC internal');
  if (!assigned.ok) return { error: assigned.error };
  values.assigned_to = assigned.value;

  // fee_structure: null, atau { tipe, detail }
  const fee = body.fee_structure;
  if (fee === undefined || fee === null) {
    values.fee_structure = null;
  } else {
    if (typeof fee !== 'object' || Array.isArray(fee)) return { error: 'Struktur fee tidak valid.' };
    const feeTipe = teksOpsional(fee.tipe, 50, 'Tipe fee');
    const feeDetail = teksOpsional(fee.detail, MAX_CATATAN, 'Detail fee');
    if (!feeTipe.ok) return { error: feeTipe.error };
    if (!feeDetail.ok) return { error: feeDetail.error };
    values.fee_structure = feeTipe.value ? { tipe: feeTipe.value, detail: feeDetail.value || '' } : null;
  }

  if (withStage) {
    const stage = body.stage === undefined || body.stage === null || body.stage === '' ? 'Prospek' : body.stage;
    if (typeof stage !== 'string' || !CRM_STAGES.includes(stage)) {
      return { error: `Stage tidak valid. Harus salah satu dari: ${CRM_STAGES.join(', ')}` };
    }
    values.stage = stage;
  }

  return { values };
}

export function validateAktivitas(body) {
  const bad = objekBody(body, 'aktivitas');
  if (bad) return bad;
  const tipe = typeof body.tipe === 'string' ? body.tipe.trim() : '';
  if (!tipe) return { error: 'Tipe aktivitas wajib diisi.' };
  if (tipe.length > 50) return { error: 'Tipe aktivitas maksimal 50 karakter.' };
  const judul = teksOpsional(body.judul, MAX_TEKS, 'Judul');
  if (!judul.ok) return { error: judul.error };
  const deskripsi = teksOpsional(body.deskripsi, MAX_CATATAN, 'Deskripsi');
  if (!deskripsi.ok) return { error: deskripsi.error };
  if (typeof body.tanggal !== 'string' || body.tanggal === '') return { error: 'Tanggal aktivitas wajib diisi.' };
  const tanggal = tanggalOpsional(body.tanggal, 'Tanggal aktivitas');
  if (!tanggal.ok) return { error: tanggal.error };
  const followUp = tanggalOpsional(body.follow_up_date, 'Tanggal follow-up');
  if (!followUp.ok) return { error: followUp.error };
  return {
    values: {
      tipe,
      judul: judul.value,
      deskripsi: deskripsi.value,
      tanggal: tanggal.value,
      follow_up_date: followUp.value,
    },
  };
}

export function validateProject(body) {
  const bad = objekBody(body, 'project');
  if (bad) return bad;
  const nama = typeof body.nama_project === 'string' ? body.nama_project.trim() : '';
  if (!nama) return { error: 'Nama project wajib diisi.' };
  if (nama.length > MAX_TEKS) return { error: `Nama project maksimal ${MAX_TEKS} karakter.` };

  const values = { nama_project: nama };
  for (const [key, max, label] of [
    ['jenis_layanan', MAX_TEKS, 'Jenis layanan'],
    ['catatan', MAX_CATATAN, 'Catatan'],
  ]) {
    const r = teksOpsional(body[key], max, label);
    if (!r.ok) return { error: r.error };
    values[key] = r.value;
  }
  const status = teksOpsional(body.status, 50, 'Status project');
  if (!status.ok) return { error: status.error };
  values.status = status.value || 'Aktif';

  const nilai = nilaiOpsional(body.nilai_kontrak, 'Nilai kontrak');
  if (!nilai.ok) return { error: nilai.error };
  values.nilai_kontrak = nilai.value;

  const mulai = tanggalOpsional(body.tanggal_mulai, 'Tanggal mulai');
  if (!mulai.ok) return { error: mulai.error };
  const selesai = tanggalOpsional(body.tanggal_selesai, 'Tanggal selesai');
  if (!selesai.ok) return { error: selesai.error };
  values.tanggal_mulai = mulai.value;
  values.tanggal_selesai = selesai.value;

  const pic = idOpsional(body.pic_madael, 'PIC Madael');
  if (!pic.ok) return { error: pic.error };
  values.pic_madael = pic.value;
  return { values };
}

export function validateDealBaru(body) {
  const bad = objekBody(body, 'deal');
  if (bad) return bad;
  const company = idOpsional(body.company_id, 'Perusahaan');
  if (!company.ok) return { error: company.error };
  if (!company.value) return { error: 'Perusahaan wajib dipilih.' };

  const stage = body.stage === undefined || body.stage === null || body.stage === '' ? 'Prospek' : body.stage;
  if (typeof stage !== 'string' || !CRM_STAGES.includes(stage)) {
    return { error: `Stage tidak valid. Harus salah satu dari: ${CRM_STAGES.join(', ')}` };
  }
  const nilai = nilaiOpsional(body.nilai_potensial, 'Nilai potensial');
  if (!nilai.ok) return { error: nilai.error };
  const pic = idOpsional(body.pic_internal, 'PIC internal');
  if (!pic.ok) return { error: pic.error };
  const catatan = teksOpsional(body.catatan, MAX_CATATAN, 'Catatan');
  if (!catatan.ok) return { error: catatan.error };

  return {
    values: {
      company_id: company.value,
      stage,
      nilai_potensial: nilai.value,
      pic_internal: pic.value,
      catatan: catatan.value,
    },
  };
}

// Cek baris ada di tabel. 22P02 (format id tidak valid) dianggap tidak ada.
// Return { ok: true } | { ok: false, response: { error, status } }
export async function pastikanAda(admin, tabel, id, pesanTidakAda, context) {
  const { data, error } = await admin.from(tabel).select('id').eq('id', id).maybeSingle();
  if (error && error.code !== '22P02') {
    return {
      ok: false,
      response: {
        error: `Gagal memeriksa data: ${friendlyError(error, 'terjadi kesalahan pada server.', { context })}`,
        status: 500,
      },
    };
  }
  if (error || !data) return { ok: false, response: { error: pesanTidakAda, status: 400 } };
  return { ok: true };
}
