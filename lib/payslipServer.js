import {
  NUMERIC_KEYS,
  PENDAPATAN_FIELDS,
  BPJS_PERUSAHAAN_FIELDS,
  POTONGAN_FIELDS,
  buildPeriodeLabel,
} from '@/lib/payslipAdminConfig';
import { todayJakarta } from '@/lib/serverTime';

// SERVER ONLY — dipakai API route simpan slip gaji (POST /api/payslips dan
// PATCH /api/payslips/[id]). `admin` WAJIB client service role
// (createAdminClient()).
//
// Dulu form Kelola Slip Gaji menulis ke tabel payslips langsung dari browser:
// validasi hanya `Number(x) || 0` di klien, nomor dokumen diambil sebelum insert
// (hangus kalau insert gagal), dan tidak ada activity log buat/ubah slip.

// Batas wajar satu nominal (Rp1 triliun) — sama dengan route payroll master.
export const MAX_NOMINAL = 1_000_000_000_000;
const MAX_TEKS = 100;
const MIN_TAHUN = 2000;
const MAX_TAHUN = 2100;

const BPJS_TK_KEYS = BPJS_PERUSAHAAN_FIELDS.map((f) => f.key);

// Data standing yang disalin dari employees_master SAAT slip dibuat. Hanya
// diterima di POST; slip yang sudah ada tidak mengubahnya (field-nya read-only
// di form, jadi perilaku edit sebelumnya juga tidak pernah mengubahnya).
export const SNAPSHOT_KEYS = ['rekening', 'npwp', 'ptkp', 'no_bpjs_k', 'no_bpjs_tk'];

// Kolom yang boleh berubah lewat edit. employee_id, nomor_dokumen, kolom
// snapshot di atas, dan is_published (hanya lewat /api/payslips/[id]/publish)
// SENGAJA tidak ada di sini.
export const EDITABLE_KEYS = [
  'periode',
  'periode_label',
  ...NUMERIC_KEYS,
  'bpjs_tk_perusahaan',
  'metode_pembayaran',
  'tanggal_pembayaran',
];

// Kolom yang dibaca sebelum edit (untuk cek status terbit + diff sebelum→sesudah).
export const EDIT_SELECT = ['id', 'employee_id', 'nomor_dokumen', 'is_published', ...EDITABLE_KEYS].join(', ');

const NOMINAL_LABEL = Object.fromEntries([
  ...PENDAPATAN_FIELDS,
  ...BPJS_PERUSAHAAN_FIELDS,
  ...POTONGAN_FIELDS,
  { key: 'bpjs_k_perusahaan', label: 'BPJS K Perusahaan' },
].map((f) => [f.key, f.label]));

// Angka bulat 0..MAX_NOMINAL, atau null kalau tidak valid. Kosong = 0 (sama
// seperti perilaku form lama: kolom nominal yang dikosongkan jadi 0).
function parseNominal(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'boolean') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0 || num > MAX_NOMINAL) return null;
  return num;
}

function parsePeriode(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) return null;
  const tahun = Number(match[1]);
  if (tahun < MIN_TAHUN || tahun > MAX_TAHUN) return null;
  return { periode: value, label: buildPeriodeLabel(match[1], match[2]) };
}

// 'YYYY-MM-DD' yang benar-benar ada di kalender, atau '' / null untuk kosong.
function parseTanggal(value) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false };
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return { ok: false };
  }
  return { ok: true, value };
}

// Teks bebas (opsional) dengan batas panjang. Ditolak, bukan dipotong, supaya
// nomor rekening/NPWP tidak diam-diam terpotong.
function parseTeks(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > MAX_TEKS ? null : trimmed;
}

// Validasi + whitelist body slip. Return { values } atau { error }.
//
// create: true  -> semua field wajib/dikenali, yang kosong jadi default;
//                  menerima employee_id dan data snapshot (SNAPSHOT_KEYS).
// create: false -> PATCH parsial: hanya key yang dikirim yang diproses;
//                  `base` (baris slip saat ini) dipakai menghitung total BPJS TK.
//
// bpjs_tk_perusahaan SELALU dihitung server dari jkk+jkm+jht+jp (browser tidak
// bisa mengirim total yang tidak cocok dengan rinciannya).
export function validatePayslipInput(body, { create, base = null }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Data slip gaji tidak valid.' };
  }
  const values = {};

  if (create) {
    if (typeof body.employee_id !== 'string' || !body.employee_id.trim()) {
      return { error: 'Karyawan wajib dipilih.' };
    }
    values.employee_id = body.employee_id.trim();
  }

  if (create || body.periode !== undefined) {
    const periode = parsePeriode(body.periode);
    if (!periode) {
      return { error: 'Periode belum lengkap atau tidak valid. Pilih Tahun (4 digit) dan Bulan terlebih dahulu.' };
    }
    values.periode = periode.periode;
    values.periode_label = periode.label;
  }

  for (const key of NUMERIC_KEYS) {
    if (!create && body[key] === undefined) continue;
    const num = parseNominal(body[key]);
    if (num === null) {
      return { error: `${NOMINAL_LABEL[key] || key} harus berupa angka bulat 0 atau lebih.` };
    }
    values[key] = num;
  }

  if (create || body.metode_pembayaran !== undefined) {
    const metode = body.metode_pembayaran === undefined ? 'Transfer' : parseTeks(body.metode_pembayaran);
    if (metode === null) {
      return { error: `Metode pembayaran tidak valid (maksimal ${MAX_TEKS} karakter).` };
    }
    values.metode_pembayaran = metode;
  }

  if (create || body.tanggal_pembayaran !== undefined) {
    const tanggal = parseTanggal(body.tanggal_pembayaran);
    if (!tanggal.ok) return { error: 'Tanggal pembayaran tidak valid.' };
    values.tanggal_pembayaran = tanggal.value;
  }

  if (create) {
    for (const key of SNAPSHOT_KEYS) {
      const teks = parseTeks(body[key]);
      if (teks === null) {
        return { error: `Data ${key} tidak valid (maksimal ${MAX_TEKS} karakter).` };
      }
      values[key] = teks;
    }
  }

  if (!create && Object.keys(values).length === 0) {
    return { error: 'Tidak ada perubahan yang dikirim.' };
  }

  const merged = { ...(base || {}), ...values };
  values.bpjs_tk_perusahaan = BPJS_TK_KEYS.reduce((sum, key) => sum + (Number(merged[key]) || 0), 0);

  return { values };
}

function normalisasi(key, value) {
  if (NUMERIC_KEYS.includes(key) || key === 'bpjs_tk_perusahaan') return Number(value ?? 0);
  return value ?? '';
}

// Selisih sebelum→sesudah untuk activity log. Hanya key EDITABLE_KEYS yang
// benar-benar berbeda; null dan 0 (atau '') dianggap sama supaya slip lama
// dengan kolom kosong tidak tercatat "berubah" tanpa perubahan nyata.
export function diffPayslip(before, after) {
  const sebelum = {};
  const sesudah = {};
  for (const key of Object.keys(after)) {
    if (!EDITABLE_KEYS.includes(key)) continue;
    if (normalisasi(key, before?.[key]) !== normalisasi(key, after[key])) {
      sebelum[key] = before?.[key] ?? null;
      sesudah[key] = after[key] ?? null;
    }
  }
  return { sebelum, sesudah };
}

// Ambil nomor dokumen slip berikutnya (counter INV). Format sama dengan
// app/api/documents/generate-number/route.js (kode_jenis 'INV'); increment
// atomik lewat fungsi Postgres increment_document_counter. Return
// { urutan, nomor } — `urutan` dipakai kalau nomor perlu dikembalikan.
// Melempar error kalau RPC gagal.
export async function ambilNomorSlip(admin) {
  const { data: urutan, error } = await admin.rpc('increment_document_counter', { p_counter_kode: 'INV' });
  if (error) throw error;
  const [tahun] = todayJakarta().split('-');
  return { urutan, nomor: `INV/${Number(tahun)}/${String(urutan).padStart(3, '0')}` };
}

// Kembalikan nomor yang diambil tetapi tidak jadi dipakai (insert slip gagal).
// Counter hanya diturunkan kalau nilainya MASIH sama dengan nomor tersebut —
// artinya belum ada pihak lain yang mengambil nomor sesudahnya, jadi tidak
// mungkin menghasilkan nomor ganda. Kalau sudah ada, nomor dibiarkan sebagai
// celah (aman). Best effort: tidak pernah melempar. Return true kalau berhasil
// dikembalikan.
export async function kembalikanNomorSlip(admin, urutan) {
  try {
    const n = Number(urutan);
    if (!Number.isInteger(n) || n < 1) return false;
    const { data, error } = await admin
      .from('document_counters')
      .update({ last_number: n - 1 })
      .eq('kode', 'INV')
      .eq('last_number', n)
      .select('id');
    if (error) {
      console.error('Gagal mengembalikan nomor slip:', error);
      return false;
    }
    return (data || []).length > 0;
  } catch (err) {
    console.error('Gagal mengembalikan nomor slip:', err);
    return false;
  }
}
