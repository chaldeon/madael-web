// Helper murni untuk Template Shift (tanpa Supabase, aman dipakai di client & server).
//
// Model: shift_templates = preset jadwal. Saat di-assign, nilainya DISALIN ke
// work_schedule karyawan + shift_template_id menautkannya. Semua modul lama tetap
// membaca work_schedule, jadi tidak ada yang perlu tahu soal template.
// Invarian: baris work_schedule dengan shift_template_id != null selalu sama dengan
// template-nya (edit template menyebar ke baris tertaut).

import { MAX_TOLERANSI_MENIT } from '@/lib/attendanceStatus';

export const HARI_OPTIONS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
export const MAX_NAMA_SHIFT = 60;

// 'HH:MM' atau 'HH:MM:SS' -> menit sejak 00:00; null kalau tidak valid.
export function toMinutes(value) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Durasi shift dalam menit (jam pulang harus setelah jam masuk di hari yang sama).
export function durasiMenit(jamMasuk, jamPulang) {
  const a = toMinutes(jamMasuk);
  const b = toMinutes(jamPulang);
  if (a === null || b === null || b <= a) return null;
  return b - a;
}

// 480 -> '8 jam', 510 -> '8 jam 30 menit', 45 -> '45 menit', null -> '—'
export function formatDurasi(menit) {
  if (menit === null || menit === undefined) return '—';
  const h = Math.floor(menit / 60);
  const m = menit % 60;
  if (h === 0) return `${m} menit`;
  return m === 0 ? `${h} jam` : `${h} jam ${m} menit`;
}

export function formatJam(value) {
  return value ? String(value).slice(0, 5) : '—';
}

// Validasi form template. Return { error } atau { value } (siap disimpan).
export function validateShiftForm(form) {
  const nama = String(form?.nama ?? '').trim();
  if (!nama) return { error: 'Nama shift wajib diisi.' };
  if (nama.length > MAX_NAMA_SHIFT) return { error: `Nama shift maksimal ${MAX_NAMA_SHIFT} karakter.` };

  if (toMinutes(form.jam_masuk) === null || toMinutes(form.jam_pulang) === null) {
    return { error: 'Jam masuk dan jam pulang wajib diisi.' };
  }
  if (durasiMenit(form.jam_masuk, form.jam_pulang) === null) {
    return { error: 'Jam pulang harus setelah jam masuk (shift lintas tengah malam belum didukung).' };
  }

  const raw = String(form.toleransi_menit ?? '').trim();
  if (!/^\d+$/.test(raw) || Number(raw) > MAX_TOLERANSI_MENIT) {
    return { error: `Toleransi harus bilangan bulat 0–${MAX_TOLERANSI_MENIT} menit.` };
  }

  const hari = HARI_OPTIONS.filter((h) => (form.hari_kerja || []).includes(h));
  if (hari.length === 0) return { error: 'Pilih minimal satu hari kerja.' };

  return {
    value: {
      nama,
      jam_masuk: form.jam_masuk,
      jam_pulang: form.jam_pulang,
      toleransi_menit: Number(raw),
      hari_kerja: hari,
      aktif: form.aktif !== false,
    },
  };
}

// Kolom work_schedule yang berasal dari sebuah template (dipakai saat assign & propagasi).
export function scheduleFieldsFromTemplate(tpl) {
  return {
    jam_masuk: tpl.jam_masuk,
    jam_pulang: tpl.jam_pulang,
    hari_kerja: tpl.hari_kerja,
    toleransi_menit: tpl.toleransi_menit,
    shift_template_id: tpl.id,
  };
}

// Label singkat shift untuk tabel: nama template, 'Kustom', atau '—' kalau belum berjadwal.
export function shiftLabel(sched, templatesById) {
  if (!sched) return '—';
  if (!sched.shift_template_id) return 'Kustom';
  return templatesById?.[sched.shift_template_id]?.nama || 'Kustom';
}