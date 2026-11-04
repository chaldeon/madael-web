// Pengingat belum clock-in — SERVER ONLY. Dipanggil oleh
// app/api/cron/clock-in-reminder/route.js.
//
// Karyawan aktif yang HARI INI wajib masuk (hari ini ada di hari_kerja jadwalnya)
// diingatkan bila belum punya clock_in dan jam sekarang sudah lewat
// jam_masuk + toleransi_menit + REMINDER_CLOCK_IN_JEDA_MENIT. Pengingat berupa
// notifikasi in-app bertipe `belum_clock_in`; email ikut terkirim lewat
// lib/notify.js sesuai preferensi kategori "pengingat".
//
// Idempoten: aman dipicu berkali-kali dalam sehari (mis. tiap 15-30 menit).
// Satu karyawan paling banyak menerima SATU pengingat per tanggal, dijaga
// dedupeKey `belum_clock_in:<tanggal>` (unique index user_id + dedupe_key di
// notifications), jadi request paralel pun aman dan tidak butuh tabel baru.
//
// Aturan "siapa dianggap belum clock-in" memakai klasifikasiKehadiran()
// (lib/kehadiranHariIni.js), yang sama dengan monitor kehadiran HR, sehingga
// karyawan yang cuti disetujui, bukan hari kerja, atau sudah clock-in tidak
// diingatkan.
//
// Batasan yang disengaja:
//   - Karyawan tanpa baris work_schedule dilewati (jam masuk tidak diketahui).
//   - Shift lintas hari (jam_pulang <= jam_masuk) dilewati, searah dengan
//     pengingat clock-out, sampai shift lintas tengah malam didukung penuh.
//   - Tidak ada pengingat setelah jam_pulang (hari kerja sudah selesai).
//   - Tanggal merah / libur nasional belum dikenali (belum ada tabel libur),
//     jadi pesan pengingat menyebut bahwa pengingat boleh diabaikan bila libur.
import { notifyEmployees } from '@/lib/notify';
import { jamJakarta, todayJakarta } from '@/lib/serverTime';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { klasifikasiKehadiran, namaHari } from '@/lib/kehadiranHariIni';

export const TIPE_BELUM_CLOCK_IN = 'belum_clock_in';
// Jeda setelah batas telat (jam_masuk + toleransi) sebelum pengingat dikirim,
// supaya karyawan yang baru tiba tidak langsung mendapat notifikasi.
export const REMINDER_CLOCK_IN_JEDA_MENIT = 15;
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

function jamPendek(time) {
  return String(time || '').slice(0, 5);
}

// Mengembalikan { tanggal, terjadwal, kandidat, diingatkan } atau melempar error
// bila pembacaan data gagal (pemanggil mengubahnya menjadi respons 500).
//   terjadwal : karyawan yang hari ini wajib masuk dan sudah lewat waktu pengingat
//   kandidat  : terjadwal yang aktif, belum clock-in, dan tidak cuti
//   diingatkan: yang benar-benar menerima notifikasi baru pada panggilan ini
export async function runClockInReminder(admin, now = new Date()) {
  const tanggal = todayJakarta(now);
  const jamSekarang = jamJakarta(now);
  const nowMenit = toMinutes(jamSekarang);
  const hariIni = namaHari(tanggal);

  // 1. Jadwal yang hari ini wajib masuk dan sudah lewat batas + jeda, tetapi
  //    belum melewati jam pulang. Disaring di memori dulu supaya query
  //    berikutnya hanya untuk karyawan yang relevan.
  const { data: jadwalRows, error: jadwalError } = await fetchAllRows(() =>
    admin.from('work_schedule').select('employee_id, jam_masuk, jam_pulang, hari_kerja, toleransi_menit')
  );
  if (jadwalError) throw jadwalError;

  const terjadwal = (jadwalRows || []).filter((s) => {
    if (!s.employee_id || !Array.isArray(s.hari_kerja) || !s.hari_kerja.includes(hariIni)) return false;
    const masuk = toMinutes(s.jam_masuk);
    const pulang = toMinutes(s.jam_pulang);
    if (masuk === null || pulang === null || pulang <= masuk) return false;
    const toleransi = Math.max(0, Math.floor(Number(s.toleransi_menit) || 0));
    const mulaiIngatkan = masuk + toleransi + REMINDER_CLOCK_IN_JEDA_MENIT;
    return nowMenit !== null && nowMenit >= mulaiIngatkan && nowMenit < pulang;
  });
  if (terjadwal.length === 0) return { tanggal, terjadwal: 0, kandidat: 0, diingatkan: 0 };

  const jadwalByEmp = new Map(terjadwal.map((s) => [String(s.employee_id), s]));
  const empIds = Array.from(jadwalByEmp.keys());

  // 2. Status akun, absensi hari ini (sudah clock-in), dan cuti disetujui hari ini.
  const aktif = new Set();
  const sudahMasuk = new Set();
  const cutiByEmp = new Map();
  for (const ids of chunk(empIds, ID_CHUNK)) {
    const [empRes, attRes, leaveRes] = await Promise.all([
      admin.from('employees').select('id, status').in('id', ids),
      admin
        .from('attendance')
        .select('employee_id')
        .eq('tanggal', tanggal)
        .not('clock_in', 'is', null)
        .in('employee_id', ids),
      admin
        .from('leave_requests')
        .select('employee_id, jenis')
        .eq('status', 'approved')
        .lte('tanggal_mulai', tanggal)
        .gte('tanggal_selesai', tanggal)
        .in('employee_id', ids),
    ]);
    if (empRes.error) throw empRes.error;
    if (attRes.error) throw attRes.error;
    if (leaveRes.error) throw leaveRes.error;
    for (const e of empRes.data || []) if (e.status === 'Aktif') aktif.add(String(e.id));
    for (const a of attRes.data || []) sudahMasuk.add(String(a.employee_id));
    for (const l of leaveRes.data || []) cutiByEmp.set(String(l.employee_id), l);
  }

  const kandidat = empIds.filter((id) => {
    if (!aktif.has(id) || sudahMasuk.has(id)) return false;
    return klasifikasiKehadiran({
      hariIni,
      jamSekarang,
      schedule: jadwalByEmp.get(id),
      attendance: null,
      cuti: cutiByEmp.get(id) || null,
    }) === 'belum_clock_in';
  });
  if (kandidat.length === 0) return { tanggal, terjadwal: terjadwal.length, kandidat: 0, diingatkan: 0 };

  // 3. Satu pengingat per karyawan per tanggal (dijaga dedupeKey di DB). Pesan
  //    memuat jam masuk masing-masing, jadi dikirim per jam masuk yang sama.
  const perJamMasuk = new Map();
  for (const id of kandidat) {
    const jam = jamPendek(jadwalByEmp.get(id).jam_masuk);
    if (!perJamMasuk.has(jam)) perJamMasuk.set(jam, []);
    perJamMasuk.get(jam).push(id);
  }

  let diingatkan = 0;
  for (const [jam, userIds] of perJamMasuk) {
    const hasil = await notifyEmployees(admin, {
      userIds,
      tipe: TIPE_BELUM_CLOCK_IN,
      pesan: `Kamu belum absen masuk hari ini (${formatTanggal(tanggal)}, jadwal masuk ${jam}). Buka halaman Absensi untuk absen masuk. Bila hari ini libur atau kamu tidak bekerja, abaikan pengingat ini.`,
      link: '/employee/absensi',
      dedupeKey: `${TIPE_BELUM_CLOCK_IN}:${tanggal}`,
    });
    diingatkan += hasil?.inserted ?? 0;
  }

  return { tanggal, terjadwal: terjadwal.length, kandidat: kandidat.length, diingatkan };
}
