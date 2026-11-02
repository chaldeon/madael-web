// Pengingat lupa clock-out — SERVER ONLY. Dipanggil oleh
// app/api/cron/clock-out-reminder/route.js.
//
// Karyawan diingatkan bila HARI INI (tanggal Jakarta) sudah punya clock_in,
// belum punya clock_out, dan jam sekarang sudah melewati jam_pulang jadwal
// kerjanya + REMINDER_DELAY_MENIT. Pengingat berupa notifikasi in-app bertipe
// `lupa_clock_out`; email ikut terkirim lewat lib/notify.js sesuai preferensi.
//
// Idempoten: aman dipicu berkali-kali dalam sehari (mis. tiap 30 menit). Satu
// karyawan paling banyak menerima SATU pengingat per hari, dicek dari tabel
// notifications (tidak butuh tabel log baru).
//
// Pengingat KEMARIN (runClockOutReminderKemarin): karyawan yang kemarin sudah
// clock in tetapi tidak pernah clock out diingatkan sekali pada hari berikutnya
// (tipe `lupa_clock_out_kemarin`), mulai REMINDER_KEMARIN_MULAI_MENIT WIB, supaya
// lupa clock-out tidak baru ketahuan saat karyawan kebetulan membuka halaman
// Absensi. Tipe dibuat terpisah dari pengingat hari ini agar kedua pengingat
// tidak saling menekan (pengingat hari ini dicek per tipe sejak 00:00 WIB).
// Idempoten lewat dedupeKey `lupa_clock_out:<tanggal sasaran>` per karyawan.
// Karyawan yang sudah punya pengajuan koreksi pending untuk tanggal itu dilewati.
//
// Batasan yang disengaja:
//   - Karyawan tanpa baris work_schedule dilewati (jam pulang tidak diketahui)
//     pada pengingat hari ini.
//   - Shift lintas hari (jam_pulang <= jam_masuk) dilewati supaya tidak ada
//     pengingat palsu di tengah shift malam.
import { notifyEmployees } from '@/lib/notify';
import { jamJakarta, todayJakarta } from '@/lib/serverTime';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { tambahHari } from '@/lib/overtimeRules';

export const TIPE_LUPA_CLOCK_OUT = 'lupa_clock_out';
export const TIPE_LUPA_CLOCK_OUT_KEMARIN = 'lupa_clock_out_kemarin';
export const REMINDER_DELAY_MENIT = 60;
// Pengingat kemarin tidak dikirim sebelum 07:00 WIB (hindari ping tengah malam).
export const REMINDER_KEMARIN_MULAI_MENIT = 7 * 60;
const ID_CHUNK = 100;

function toMinutes(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function formatTanggal(tanggal) {
  return new Date(`${tanggal}T00:00:00`).toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Mengembalikan { tanggal, terbuka, kandidat, diingatkan } atau melempar error
// bila pembacaan data gagal (pemanggil mengubahnya menjadi respons 500).
export async function runClockOutReminder(admin, now = new Date()) {
  const tanggal = todayJakarta(now);
  const nowMenit = toMinutes(jamJakarta(now));

  // 1. Baris hari ini: sudah masuk, belum pulang.
  const { data: rows, error: rowsError } = await fetchAllRows(() =>
    admin
      .from('attendance')
      .select('id, employee_id')
      .eq('tanggal', tanggal)
      .not('clock_in', 'is', null)
      .is('clock_out', null)
  );
  if (rowsError) throw rowsError;

  const empIds = Array.from(new Set((rows || []).map((r) => r.employee_id).filter(Boolean)));
  if (empIds.length === 0) return { tanggal, terbuka: 0, kandidat: 0, diingatkan: 0 };

  // 2. Hanya karyawan aktif yang jadwal pulangnya sudah lewat + jeda.
  const jadwal = new Map();
  const aktif = new Set();
  for (const ids of chunk(empIds, ID_CHUNK)) {
    const [empRes, schedRes] = await Promise.all([
      admin.from('employees').select('id, status').in('id', ids),
      admin.from('work_schedule').select('employee_id, jam_masuk, jam_pulang').in('employee_id', ids),
    ]);
    if (empRes.error) throw empRes.error;
    if (schedRes.error) throw schedRes.error;
    for (const e of empRes.data || []) if (e.status === 'Aktif') aktif.add(String(e.id));
    for (const s of schedRes.data || []) jadwal.set(String(s.employee_id), s);
  }

  const kandidat = empIds.filter((id) => {
    if (!aktif.has(String(id))) return false;
    const s = jadwal.get(String(id));
    const masuk = toMinutes(s?.jam_masuk);
    const pulang = toMinutes(s?.jam_pulang);
    if (pulang === null || (masuk !== null && pulang <= masuk)) return false;
    return nowMenit >= pulang + REMINDER_DELAY_MENIT;
  });
  if (kandidat.length === 0) {
    return { tanggal, terbuka: empIds.length, kandidat: 0, diingatkan: 0 };
  }

  // 3. Buang yang sudah diingatkan hari ini (sejak 00:00 WIB).
  const awalHari = `${tanggal}T00:00:00+07:00`;
  const sudah = new Set();
  for (const ids of chunk(kandidat, ID_CHUNK)) {
    const { data, error } = await admin
      .from('notifications')
      .select('user_id')
      .eq('tipe', TIPE_LUPA_CLOCK_OUT)
      .gte('created_at', awalHari)
      .in('user_id', ids);
    if (error) throw error;
    for (const n of data || []) sudah.add(String(n.user_id));
  }
  const target = kandidat.filter((id) => !sudah.has(String(id)));

  if (target.length > 0) {
    await notifyEmployees(admin, {
      userIds: target,
      tipe: TIPE_LUPA_CLOCK_OUT,
      pesan: `Kamu belum absen pulang hari ini (${formatTanggal(tanggal)}). Buka halaman Absensi untuk absen pulang, atau ajukan koreksi absensi bila waktu pulang sudah terlewat.`,
      link: '/employee/absensi',
    });
  }

  return { tanggal, terbuka: empIds.length, kandidat: kandidat.length, diingatkan: target.length };
}

// Pengingat untuk baris KEMARIN yang masih tanpa clock out. Mengembalikan
// { tanggal, terbuka, kandidat, diingatkan, ditunda } atau melempar error bila
// pembacaan data gagal. `ditunda: true` = belum lewat REMINDER_KEMARIN_MULAI_MENIT.
export async function runClockOutReminderKemarin(admin, now = new Date()) {
  const tanggal = tambahHari(todayJakarta(now), -1);
  const nowMenit = toMinutes(jamJakarta(now));
  if (nowMenit === null || nowMenit < REMINDER_KEMARIN_MULAI_MENIT) {
    return { tanggal, terbuka: 0, kandidat: 0, diingatkan: 0, ditunda: true };
  }

  // 1. Baris kemarin: sudah masuk, tidak pernah pulang.
  const { data: rows, error: rowsError } = await fetchAllRows(() =>
    admin
      .from('attendance')
      .select('id, employee_id')
      .eq('tanggal', tanggal)
      .not('clock_in', 'is', null)
      .is('clock_out', null)
  );
  if (rowsError) throw rowsError;

  const empIds = Array.from(new Set((rows || []).map((r) => r.employee_id).filter(Boolean)));
  if (empIds.length === 0) return { tanggal, terbuka: 0, kandidat: 0, diingatkan: 0, ditunda: false };

  // 2. Hanya karyawan aktif yang belum mengajukan koreksi untuk tanggal itu.
  const aktif = new Set();
  const sudahAjukan = new Set();
  for (const ids of chunk(empIds, ID_CHUNK)) {
    const [empRes, korRes] = await Promise.all([
      admin.from('employees').select('id, status').in('id', ids),
      admin
        .from('attendance_corrections')
        .select('employee_id')
        .eq('tanggal', tanggal)
        .eq('status', 'pending')
        .in('employee_id', ids),
    ]);
    if (empRes.error) throw empRes.error;
    if (korRes.error) throw korRes.error;
    for (const e of empRes.data || []) if (e.status === 'Aktif') aktif.add(String(e.id));
    for (const k of korRes.data || []) sudahAjukan.add(String(k.employee_id));
  }
  const kandidat = empIds.filter((id) => aktif.has(String(id)) && !sudahAjukan.has(String(id)));
  if (kandidat.length === 0) {
    return { tanggal, terbuka: empIds.length, kandidat: 0, diingatkan: 0, ditunda: false };
  }

  // 3. Satu pengingat per karyawan per tanggal sasaran (dijaga dedupeKey di DB).
  const hasil = await notifyEmployees(admin, {
    userIds: kandidat,
    tipe: TIPE_LUPA_CLOCK_OUT_KEMARIN,
    pesan: `Kamu belum absen pulang pada ${formatTanggal(tanggal)}. Buka halaman Absensi lalu ajukan koreksi jam pulang dengan foto bukti agar jam kerjamu ikut dihitung.`,
    link: '/employee/absensi',
    dedupeKey: `${TIPE_LUPA_CLOCK_OUT}:${tanggal}`,
  });

  return {
    tanggal,
    terbuka: empIds.length,
    kandidat: kandidat.length,
    diingatkan: hasil?.inserted ?? 0,
    ditunda: false,
  };
}
