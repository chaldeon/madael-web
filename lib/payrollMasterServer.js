import { STATUS_OPTIONS } from '@/lib/payrollConfig';
import { PTKP_DATA, JKK_OPTIONS } from '@/lib/payroll/calculations';
import { validateKepegawaian } from '@/lib/kepegawaian';
import { parseJatahCutiKaryawan } from '@/lib/leavePolicy';
import { tahunSekarang } from '@/lib/leave';

// SERVER ONLY — validasi, whitelist kolom, dan diff audit untuk penulisan
// employees_master dari Payroll Manager (POST /api/payroll/master dan
// PATCH /api/payroll/master/[id]).
//
// Dulu form lengkap (gaji, tunjangan, komponen lain, NPWP, rekening, BPJS, jatah
// cuti, carry-over) menulis ke employees_master langsung dari browser: validasi
// hanya di klien, log aktivitas dikirim sesudah write (bisa hilang bila tab
// ditutup) dan tidak memuat nilai sebelum→sesudah.

export const MAX_NOMINAL = 1_000_000_000_000;
const MAX_NAMA = 200;
const MAX_POSISI = 200;
const MAX_NAMA_REKENING = 100;
const MAX_NAMA_BANK = 50;
const MAX_KOMPONEN = 30;
const MAX_KOMPONEN_KEY = 100;
const MAX_CARRY_OVER = 365;

// Kolom employees_master yang boleh ditulis lewat form. id, created_at, counter
// cuti_terpakai*, kolom dokumen Drive, dan kolom lain SENGAJA tidak ada di sini.
export const MASTER_FIELDS = [
  'nama',
  'client_id',
  'posisi',
  'status',
  'tanggal_bergabung',
  'jenis_hubungan_kerja',
  'kontrak_berakhir',
  'gaji_pokok',
  'tunjangan',
  'komponen_lain',
  'linked_employee_id',
  'status_ptkp',
  'npwp_status',
  'npwp',
  'jkk_rate',
  'no_bpjs_kesehatan',
  'no_bpjs_ketenagakerjaan',
  'nama_rekening',
  'no_rekening',
  'nama_bank',
  'jatah_cuti_tahunan',
];

// Carry-over ditulis berpasangan dengan tahunnya (diisi server, bukan klien).
const CARRY_KEYS = ['cuti_carry_over', 'cuti_carry_over_tahun'];

// Kolom yang dibaca sebelum/sesudah penulisan (diff + respons).
export const MASTER_SELECT = ['id', ...MASTER_FIELDS, ...CARRY_KEYS].join(', ');

// Data identitas yang tidak ditulis utuh ke activity log (hanya 4 digit akhir).
export const SENSITIVE_KEYS = ['npwp', 'no_rekening', 'no_bpjs_kesehatan', 'no_bpjs_ketenagakerjaan'];

const NAMA_FIELD = {
  nama: 'Nama',
  gaji_pokok: 'Gaji pokok',
  tunjangan: 'Tunjangan',
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Nominal rupiah 0..MAX_NOMINAL, atau null bila tidak valid. Aturan sama dengan
// PATCH lama (angka hingga, tidak negatif); '' dan boolean ditolak.
function parseNominal(value) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > MAX_NOMINAL) return null;
  return num;
}

// Kosong ('' / null / undefined / spasi saja) -> null; selain string -> undefined
// (= tidak valid); selain itu string yang sudah di-trim.
function teksOpsional(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function jumlahDigit(text) {
  return text.replace(/\D/g, '').length;
}

// Nilai yang sama persis dengan yang sudah tersimpan tidak divalidasi ulang
// formatnya: data lama yang formatnya tidak baku tetap bisa disimpan ulang
// (mis. saat HR hanya mengubah gaji). Format hanya ditegakkan untuk nilai BARU.
function tidakBerubah(before, key, value) {
  if (!before || !(key in before)) return false;
  const lama = before[key] === null || before[key] === undefined ? null : String(before[key]).trim();
  return lama === value;
}

// NPWP: angka/titik/strip/spasi dengan 15 digit (format lama) atau 16 digit.
function formatNpwpValid(text) {
  if (!/^[\d.\-\s]+$/.test(text)) return false;
  const digits = jumlahDigit(text);
  return digits === 15 || digits === 16;
}

// Rekening bank: angka (boleh spasi/strip pemisah), 5–25 digit.
function formatRekeningValid(text) {
  if (text.length > 40 || !/^[\d\-\s]+$/.test(text)) return false;
  const digits = jumlahDigit(text);
  return digits >= 5 && digits <= 25;
}

// Nomor BPJS: angka (boleh spasi/strip), 8–20 digit. Sengaja longgar karena
// panjang nomor berbeda per jenis dan kartu; yang dicegah hanya isian ngawur.
function formatBpjsValid(text) {
  if (text.length > 30 || !/^[\d\-\s]+$/.test(text)) return false;
  const digits = jumlahDigit(text);
  return digits >= 8 && digits <= 20;
}

function parseKomponenLain(value) {
  if (!isPlainObject(value)) return { error: 'Komponen lain tidak valid.' };
  const entries = Object.entries(value);
  if (entries.length > MAX_KOMPONEN) {
    return { error: `Komponen lain maksimal ${MAX_KOMPONEN} baris.` };
  }
  const seen = new Set();
  const hasil = [];
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (!key) continue; // baris tanpa nama diabaikan, sama seperti pairsToObj di form
    if (key.length > MAX_KOMPONEN_KEY) {
      return { error: `Nama komponen lain maksimal ${MAX_KOMPONEN_KEY} karakter.` };
    }
    if (seen.has(key)) {
      return { error: `Nama komponen lain "${key}" dobel.` };
    }
    seen.add(key);
    const nominal = rawValue === '' || rawValue === null ? 0 : parseNominal(rawValue);
    if (nominal === null) {
      return { error: `Nominal komponen "${key}" harus berupa angka 0 atau lebih.` };
    }
    hasil.push([key, nominal]);
  }
  // fromEntries membuat properti milik sendiri (aman untuk kunci seperti __proto__).
  return { value: Object.fromEntries(hasil) };
}

// Validasi + whitelist body form Payroll Manager. Return { values } atau { error }.
//
// create: true  -> semua kolom dikenali; yang tidak dikirim memakai default yang
//                  sama dengan form kosong (status PHL, gaji 0, jatah cuti 12).
// create: false -> PATCH parsial: hanya key yang dikirim yang diproses; `before`
//                  (baris saat ini) dipakai untuk aturan antar-field kepegawaian
//                  dan agar data lama yang tidak berubah tidak ditolak formatnya.
//
// Pengecekan yang butuh database (klien ada, akun absensi belum dipakai baris
// lain) dilakukan di route.
export function validateMasterInput(body, { create, before = null }) {
  if (!isPlainObject(body)) return { error: 'Data karyawan tidak valid.' };
  const values = {};
  const sent = (key) => body[key] !== undefined;

  if (create || sent('nama')) {
    if (typeof body.nama !== 'string' || !body.nama.trim()) return { error: 'Nama wajib diisi.' };
    if (body.nama.trim().length > MAX_NAMA) return { error: `Nama maksimal ${MAX_NAMA} karakter.` };
    values.nama = body.nama.trim();
  }

  if (create || sent('client_id')) {
    const clientId = teksOpsional(body.client_id);
    if (clientId === undefined) return { error: 'Klien tidak valid.' };
    values.client_id = clientId;
  }

  if (create || sent('posisi')) {
    if (body.posisi !== undefined && typeof body.posisi !== 'string') return { error: 'Posisi tidak valid.' };
    values.posisi = (body.posisi || '').trim().slice(0, MAX_POSISI);
  }

  if (create || sent('status')) {
    const status = body.status === undefined ? STATUS_OPTIONS[0] : body.status;
    if (!STATUS_OPTIONS.includes(status)) return { error: 'Status karyawan tidak valid.' };
    values.status = status;
  }

  for (const key of ['gaji_pokok', 'tunjangan']) {
    if (!create && !sent(key)) continue;
    const nominal = body[key] === undefined ? 0 : parseNominal(body[key]);
    if (nominal === null) return { error: `${NAMA_FIELD[key]} harus berupa angka 0 atau lebih.` };
    values[key] = nominal;
  }

  if (create || sent('komponen_lain')) {
    const komponen = body.komponen_lain === undefined ? { value: {} } : parseKomponenLain(body.komponen_lain);
    if (komponen.error) return { error: komponen.error };
    values.komponen_lain = komponen.value;
  }

  if (create || sent('linked_employee_id')) {
    const linked = teksOpsional(body.linked_employee_id);
    if (linked === undefined) return { error: 'Akun absensi tidak valid.' };
    values.linked_employee_id = linked;
  }

  if (create || sent('status_ptkp')) {
    const ptkp = teksOpsional(body.status_ptkp);
    if (ptkp === undefined) return { error: 'Status PTKP tidak valid.' };
    if (ptkp !== null && !(ptkp in PTKP_DATA) && !tidakBerubah(before, 'status_ptkp', ptkp)) {
      return { error: 'Status PTKP tidak valid.' };
    }
    values.status_ptkp = ptkp;
  }

  if (create || sent('npwp_status')) {
    const npwpStatus = teksOpsional(body.npwp_status);
    if (npwpStatus === undefined || (npwpStatus !== null && !['ada', 'tidak'].includes(npwpStatus))) {
      return { error: 'Status NPWP tidak valid.' };
    }
    values.npwp_status = npwpStatus;
  }

  if (create || sent('npwp')) {
    const npwp = teksOpsional(body.npwp);
    if (npwp === undefined) return { error: 'Nomor NPWP tidak valid.' };
    if (npwp !== null && !tidakBerubah(before, 'npwp', npwp) && !formatNpwpValid(npwp)) {
      return { error: 'Nomor NPWP harus 15 atau 16 digit angka (boleh memakai titik dan strip).' };
    }
    values.npwp = npwp;
  }

  if (create || sent('jkk_rate')) {
    const raw = body.jkk_rate;
    if (raw === undefined || raw === null || raw === '') {
      values.jkk_rate = null;
    } else {
      const rate = typeof raw === 'boolean' ? NaN : Number(raw);
      const dikenal = JKK_OPTIONS.some((o) => Math.abs(o.value - rate) < 1e-9);
      const sama = before && before.jkk_rate !== null && before.jkk_rate !== undefined
        && Math.abs(Number(before.jkk_rate) - rate) < 1e-9;
      if (!Number.isFinite(rate) || (!dikenal && !sama)) return { error: 'Tarif JKK tidak valid.' };
      values.jkk_rate = rate;
    }
  }

  for (const [key, label] of [
    ['no_bpjs_kesehatan', 'Nomor BPJS Kesehatan'],
    ['no_bpjs_ketenagakerjaan', 'Nomor BPJS Ketenagakerjaan'],
  ]) {
    if (!create && !sent(key)) continue;
    const nomor = teksOpsional(body[key]);
    if (nomor === undefined) return { error: `${label} tidak valid.` };
    if (nomor !== null && !tidakBerubah(before, key, nomor) && !formatBpjsValid(nomor)) {
      return { error: `${label} harus berupa angka 8–20 digit.` };
    }
    values[key] = nomor;
  }

  if (create || sent('nama_rekening')) {
    const namaRekening = teksOpsional(body.nama_rekening);
    if (namaRekening === undefined) return { error: 'Nama rekening tidak valid.' };
    if (namaRekening !== null && namaRekening.length > MAX_NAMA_REKENING) {
      return { error: `Nama rekening maksimal ${MAX_NAMA_REKENING} karakter.` };
    }
    values.nama_rekening = namaRekening;
  }

  if (create || sent('nama_bank')) {
    const namaBank = teksOpsional(body.nama_bank);
    if (namaBank === undefined) return { error: 'Nama bank tidak valid.' };
    if (namaBank !== null && namaBank.length > MAX_NAMA_BANK) {
      return { error: `Nama bank maksimal ${MAX_NAMA_BANK} karakter.` };
    }
    values.nama_bank = namaBank;
  }

  if (create || sent('no_rekening')) {
    const noRekening = teksOpsional(body.no_rekening);
    if (noRekening === undefined) return { error: 'Nomor rekening tidak valid.' };
    if (noRekening !== null && !tidakBerubah(before, 'no_rekening', noRekening) && !formatRekeningValid(noRekening)) {
      return { error: 'Nomor rekening harus berupa angka 5–25 digit.' };
    }
    values.no_rekening = noRekening;
  }

  if (create || sent('jatah_cuti_tahunan')) {
    const jatah = parseJatahCutiKaryawan(body.jatah_cuti_tahunan);
    if (jatah.error) return { error: jatah.error };
    values.jatah_cuti_tahunan = jatah.value;
  }

  // Carry-over hanya ditulis bila dikirim (klien mengirimnya hanya saat HR
  // mengubahnya, supaya hitungan otomatis tidak terkunci). Tahunnya diisi server.
  if (sent('cuti_carry_over')) {
    const raw = body.cuti_carry_over;
    const carry = raw === '' || raw === null || typeof raw === 'boolean' ? NaN : Number(raw);
    if (!Number.isFinite(carry) || carry < 0 || carry > MAX_CARRY_OVER) {
      return { error: `Carry-over cuti harus berupa angka 0–${MAX_CARRY_OVER}.` };
    }
    values.cuti_carry_over = carry;
    values.cuti_carry_over_tahun = tahunSekarang();
  }

  // Data kepegawaian: string 'YYYY-MM-DD' / jenis, atau ''/null untuk mengosongkan.
  for (const key of ['tanggal_bergabung', 'jenis_hubungan_kerja', 'kontrak_berakhir']) {
    if (!create && !sent(key)) continue;
    if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') {
      return { error: 'Data kepegawaian tidak valid.' };
    }
    values[key] = body[key] ? body[key].trim() || null : null;
  }
  // Ganti ke PKWTT tanpa menyebut tanggal berakhir = kosongkan tanggal itu
  // (PKWTT tidak punya tanggal berakhir).
  if (values.jenis_hubungan_kerja === 'PKWTT' && !create && !sent('kontrak_berakhir')) {
    values.kontrak_berakhir = null;
  }
  if (['tanggal_bergabung', 'jenis_hubungan_kerja', 'kontrak_berakhir'].some((key) => key in values)) {
    const gabungan = (key) => (key in values ? values[key] : before?.[key]);
    const kepegawaianError = validateKepegawaian({
      tanggal_bergabung: gabungan('tanggal_bergabung'),
      jenis_hubungan_kerja: gabungan('jenis_hubungan_kerja'),
      kontrak_berakhir: gabungan('kontrak_berakhir'),
    });
    if (kepegawaianError) return { error: kepegawaianError };
  }

  if (!create && Object.keys(values).length === 0) {
    return { error: 'Tidak ada perubahan yang dikirim.' };
  }
  return { values };
}

// Nilai pembanding diff: null/undefined/'' dianggap sama (kolom teks kosong vs
// NULL tidak dihitung sebagai perubahan); angka dibandingkan sebagai angka;
// komponen_lain dibandingkan isinya tanpa peduli urutan kunci.
function normalisasi(key, value) {
  if (key === 'komponen_lain') {
    const entries = Object.entries(value || {}).map(([k, v]) => [k, Number(v) || 0]);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return JSON.stringify(entries);
  }
  if (value === null || value === undefined || value === '') return null;
  if (['gaji_pokok', 'tunjangan', 'jkk_rate', 'jatah_cuti_tahunan', 'cuti_carry_over', 'cuti_carry_over_tahun'].includes(key)) {
    return Number(value);
  }
  return typeof value === 'string' ? value.trim() : value;
}

// Selisih sebelum→sesudah untuk activity log. Hanya key di `values` yang benar-
// benar berbeda dari `before`. Dipakai juga untuk memutuskan perlu-tidaknya UPDATE.
export function diffMaster(before, values) {
  const sebelum = {};
  const sesudah = {};
  for (const key of Object.keys(values)) {
    if (normalisasi(key, before?.[key]) !== normalisasi(key, values[key])) {
      sebelum[key] = before?.[key] ?? null;
      sesudah[key] = values[key] ?? null;
    }
  }
  return { sebelum, sesudah };
}

// '1234567890' -> '••••7890'. Dipakai agar NPWP/rekening/BPJS tidak tersimpan
// utuh di activity log (yang bisa dibaca lebih banyak orang daripada modul payroll).
export function maskIdentitas(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  return `••••${text.slice(-4)}`;
}

// Salinan objek diff dengan kolom identitas disamarkan.
export function samarkanUntukLog(obj) {
  const hasil = { ...obj };
  for (const key of SENSITIVE_KEYS) {
    if (key in hasil) hasil[key] = maskIdentitas(hasil[key]);
  }
  return hasil;
}

// Pengecekan database yang dipakai POST dan PATCH. Return pesan error + status
// atau null bila lolos. `masterId` = baris yang sedang diedit (null saat tambah).
//   - client_id harus ada di companies (hanya dicek bila berubah/baru).
//   - linked_employee_id harus akun yang ada dan belum dipakai baris master lain.
export async function cekRelasiMaster(admin, values, { masterId = null, before = null } = {}) {
  if (values.client_id && values.client_id !== before?.client_id) {
    const { data, error } = await admin.from('companies').select('id').eq('id', values.client_id).maybeSingle();
    if (error && error.code !== '22P02') throw error;
    if (error || !data) return { error: 'Klien tidak ditemukan.', status: 400 };
  }

  if (values.linked_employee_id && values.linked_employee_id !== before?.linked_employee_id) {
    const { data: akun, error: akunError } = await admin
      .from('employees')
      .select('id')
      .eq('id', values.linked_employee_id)
      .maybeSingle();
    if (akunError && akunError.code !== '22P02') throw akunError;
    if (akunError || !akun) return { error: 'Akun absensi tidak ditemukan.', status: 400 };

    let query = admin.from('employees_master').select('id').eq('linked_employee_id', values.linked_employee_id);
    if (masterId) query = query.neq('id', masterId);
    const { data: dipakai, error: dipakaiError } = await query.limit(1);
    if (dipakaiError) throw dipakaiError;
    if (dipakai && dipakai.length > 0) {
      return { error: 'Akun absensi ini sudah terhubung ke employee master lain.', status: 409 };
    }
  }

  return null;
}
