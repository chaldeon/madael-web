import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { MAX_TOLERANSI_MENIT } from '@/lib/attendanceStatus';
import { HARI_OPTIONS, toMinutes, validateShiftForm } from '@/lib/shifts';

// SERVER ONLY — gate dan validasi untuk route jadwal kerja (work_schedule) dan
// template shift (shift_templates) di /api/attendance/schedule/*.
//
// Dulu tab "Jadwal Kerja" dan "Template Shift" menulis langsung dari browser;
// jam, hari kerja, dan toleransi hanya divalidasi di klien. Jadwal inilah yang
// menentukan status telat, jam pulang (pengingat clock-out), dan hari kerja
// (kuota cuti, lembur), jadi nilainya harus dipastikan benar di server.

// Batas jumlah karyawan per permintaan massal, dan ukuran potongan untuk filter
// `.in()` supaya URL ke PostgREST tidak kelewat panjang.
export const MAKS_KARYAWAN_MASSAL = 500;
export const UKURAN_POTONGAN = 100;

// Kolom template yang diset dari form (dipakai juga untuk memulihkan template
// kalau penyebaran ke jadwal karyawan gagal).
export const KOLOM_TEMPLATE = ['nama', 'jam_masuk', 'jam_pulang', 'toleransi_menit', 'hari_kerja', 'aktif'];

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const isSafeId = (v) => typeof v === 'string' && ID_RE.test(v);

// Sama dengan tab Lokasi Kerja dan route QR: khusus superadmin yang juga
// memegang modul absensi_admin (halaman Kelola Absensi Tim hanya terbuka untuk
// superadmin). Return { emp } atau { error, status }.
export async function requireJadwalAdmin(admin) {
  const access = await requireModuleAccess(admin, ['absensi_admin']);
  if (access.error) return access;
  if (!access.emp.is_superadmin) {
    return { error: 'Hanya superadmin yang boleh mengelola jadwal kerja.', status: 403 };
  }
  return { emp: access.emp };
}

// 'H:MM' / 'HH:MM:SS' -> 'HH:MM' (null kalau tidak valid).
export function normalisasiJam(value) {
  const menit = toMinutes(value);
  if (menit === null) return null;
  return `${String(Math.floor(menit / 60)).padStart(2, '0')}:${String(menit % 60).padStart(2, '0')}`;
}

// Toleransi: bilangan bulat 0..MAX_TOLERANSI_MENIT (angka atau string angka).
export function parseToleransiServer(value) {
  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n <= MAX_TOLERANSI_MENIT ? n : null;
}

// Hari kerja: array nama hari yang dikenal, tanpa duplikat, urut Senin..Minggu.
export function parseHariKerja(value) {
  if (!Array.isArray(value)) return null;
  if (!value.every((h) => typeof h === 'string' && HARI_OPTIONS.includes(h))) return null;
  const hari = HARI_OPTIONS.filter((h) => value.includes(h));
  return hari.length > 0 ? hari : null;
}

// Validasi jadwal kustom satu karyawan. Return { ok: true, value } atau { ok: false, error }.
// Jam pulang tidak wajib setelah jam masuk di sini (jadwal lama bisa lintas hari;
// pengingat clock-out sudah melewati kasus itu) — hanya format jamnya yang dijaga.
export function validateJadwalKustom(body) {
  const jamMasuk = normalisasiJam(body?.jam_masuk);
  const jamPulang = normalisasiJam(body?.jam_pulang);
  if (!jamMasuk || !jamPulang) return { ok: false, error: 'Jam masuk dan jam pulang wajib diisi dengan format jam yang benar.' };

  const hari = parseHariKerja(body?.hari_kerja);
  if (!hari) return { ok: false, error: 'Pilih minimal satu hari kerja yang valid.' };

  const toleransi = parseToleransiServer(body?.toleransi_menit);
  if (toleransi === null) {
    return { ok: false, error: `Toleransi harus bilangan bulat 0–${MAX_TOLERANSI_MENIT} menit.` };
  }

  return {
    ok: true,
    value: { jam_masuk: jamMasuk, jam_pulang: jamPulang, hari_kerja: hari, toleransi_menit: toleransi },
  };
}

// Validasi form template shift (aturan sama dengan klien: lib/shifts.js), plus
// pengecekan tipe karena body berasal dari luar. Return { ok, value } / { ok: false, error }.
export function validateTemplateInput(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Data shift tidak valid.' };
  if (typeof body.nama !== 'string') return { ok: false, error: 'Nama shift wajib diisi.' };
  if (!Array.isArray(body.hari_kerja)) return { ok: false, error: 'Pilih minimal satu hari kerja.' };
  if (!body.hari_kerja.every((h) => typeof h === 'string' && HARI_OPTIONS.includes(h))) {
    return { ok: false, error: 'Hari kerja tidak valid.' };
  }
  if (body.aktif !== undefined && typeof body.aktif !== 'boolean') {
    return { ok: false, error: 'Status aktif tidak valid.' };
  }
  const toleransi = parseToleransiServer(body.toleransi_menit);
  if (toleransi === null) {
    return { ok: false, error: `Toleransi harus bilangan bulat 0–${MAX_TOLERANSI_MENIT} menit.` };
  }

  const { error, value } = validateShiftForm({ ...body, toleransi_menit: String(toleransi) });
  if (error) return { ok: false, error };

  return {
    ok: true,
    value: {
      ...value,
      jam_masuk: normalisasiJam(value.jam_masuk),
      jam_pulang: normalisasiJam(value.jam_pulang),
    },
  };
}

// Daftar id karyawan untuk aksi massal: array string aman, unik, 1..MAKS_KARYAWAN_MASSAL.
export function parseEmployeeIds(value) {
  if (!Array.isArray(value) || value.length === 0) return { error: 'Tidak ada karyawan yang dipilih.' };
  if (!value.every(isSafeId)) return { error: 'Daftar karyawan tidak valid.' };
  const unik = [...new Set(value)];
  if (unik.length > MAKS_KARYAWAN_MASSAL) {
    return { error: `Maksimal ${MAKS_KARYAWAN_MASSAL} karyawan per permintaan. Persempit filter perusahaan/cabang.` };
  }
  return { ids: unik };
}

export function potong(list, ukuran = UKURAN_POTONGAN) {
  const hasil = [];
  for (let i = 0; i < list.length; i += ukuran) hasil.push(list.slice(i, i + ukuran));
  return hasil;
}

// Ambil satu template. Return { template } | { error, status }.
export async function ambilTemplate(admin, id) {
  if (!isSafeId(id)) return { error: 'Template shift tidak ditemukan.', status: 404 };
  const { data, error } = await admin.from('shift_templates').select('*').eq('id', id).maybeSingle();
  if (error) return { error: 'Gagal memuat template shift.', status: 500, cause: error };
  if (!data) return { error: 'Template shift tidak ditemukan.', status: 404 };
  return { template: data };
}
