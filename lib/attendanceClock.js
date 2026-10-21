// Logika inti clock in/out (server only), dipakai bersama oleh tiga route:
//   - POST /api/attendance/clock          simpan langsung (layar konfirmasi dilewati)
//   - POST /api/attendance/clock/preview  hitung + ringkasan, TIDAK menyimpan
//   - POST /api/attendance/clock/confirm  simpan hasil yang sudah dihitung preview
//
// Semua fungsi menerima `admin` (client service role) dari pemanggil — jangan
// import file ini dari komponen client. Aturan bisnisnya (telat + toleransi,
// geofence, verifikasi wajah, kolom yang ditulis) dipindahkan APA ADANYA dari
// app/api/attendance/clock/route.js; jangan diubah tanpa mengubah ketiganya sekaligus
// (itu alasan file ini dipisah: satu sumber kebenaran).

import { checkGeofence, resolveEmployeeLocations } from '@/lib/geofence';
import { descriptorDistance, isFaceMatch, similarityPercent } from '@/lib/faceVerification';
import { jamJakarta } from '@/lib/serverTime';
import { hitungStatusTelat } from '@/lib/attendanceStatus';
import { resolveQrLocation } from '@/lib/attendanceQr';

// ---- Ambang penandaan review (tidak pernah memblokir absen) ----
// Akurasi GPS (radius ketidakpastian yang dilaporkan browser, meter). Lebih besar dari
// ini = posisi tidak bisa dipercaya untuk geofence (radius default lokasi kerja 150 m).
export const GPS_AKURASI_MAKS_METER = 100;
// Verifikasi wajah "dilewati" (ada foto referensi tapi descriptor tidak dikirim) sekali
// itu wajar (model gagal dimuat, dll). Ditandai review kalau terjadi di >= AMBANG hari
// berbeda dalam JENDELA hari terakhir (termasuk hari ini).
export const WAJAH_DILEWATI_JENDELA_HARI = 7;
export const WAJAH_DILEWATI_AMBANG_HARI = 2;

// Akurasi GPS mentah dari client -> angka (meter, 1 desimal) atau null kalau tidak
// ada / tidak valid. Browser selalu melaporkan coords.accuracy, jadi null berarti
// klien lama atau panggilan API langsung.
export function normalizeAkurasi(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
  return Math.min(Math.round(raw * 10) / 10, 99999.9);
}

// { meter, buruk }. Akurasi tidak terbaca dianggap buruk (tidak bisa dipastikan).
export function evaluateGpsAkurasi(raw) {
  const meter = normalizeAkurasi(raw);
  return { meter, buruk: meter == null || meter > GPS_AKURASI_MAKS_METER };
}

// 'YYYY-MM-DD' digeser `hari` hari (kalender murni, tanpa zona waktu).
function geserTanggal(tanggal, hari) {
  const d = new Date(`${tanggal}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

// Gabungkan hasil verifikasi wajah clock-in & clock-out: kalau salah satu
// gagal cocok, hasil akhirnya dianggap gagal (perlu review) — bukan ditimpa
// jadi "berhasil" cuma karena yang satunya kebetulan cocok.
function combineWajahStatus(a, b) {
  if (a === false || b === false) return false;
  if (a === true || b === true) return true;
  return null;
}

// Hasil verifikasi wajah dari descriptor referensi (server-only) vs descriptor frame.
//   status: 'cocok' | 'tidak_cocok' | 'tidak_terdeteksi' | 'belum_dicek' | 'tanpa_referensi'
//   ok:       true | false | null  (yang disimpan ke attendance.wajah_terverifikasi)
//   distance: jarak Euclidean (yang disimpan ke attendance.wajah_similarity) atau null
//   dilewati: true bila ada referensi tapi descriptor tidak dikirim ('belum_dicek')
//   berulang: diisi evaluateClock (butuh riwayat DB); di sini selalu false
export function wajahFrom(referensi, descriptor) {
  if (referensi && Array.isArray(descriptor)) {
    const raw = descriptorDistance(descriptor, referensi);
    const ok = isFaceMatch(raw);
    // Infinity/NaN (descriptor tidak sepanjang referensi, dst) tidak bisa disimpan
    // sebagai angka; JSON.stringify sudah mengubahnya jadi null di route lama.
    const distance = Number.isFinite(raw) ? raw : null;
    return { status: ok ? 'cocok' : 'tidak_cocok', ok, distance, dilewati: false, berulang: false };
  }
  if (referensi && descriptor === null) {
    // Kamera sempat jalan tapi wajah tidak terdeteksi jelas — beda dari "belum
    // sempat dicoba" (descriptor tidak dikirim sama sekali), yang dianggap
    // "belum bisa dicek" (null), bukan gagal.
    return { status: 'tidak_terdeteksi', ok: false, distance: null, dilewati: false, berulang: false };
  }
  if (referensi) return { status: 'belum_dicek', ok: null, distance: null, dilewati: true, berulang: false };
  return { status: 'tanpa_referensi', ok: null, distance: null, dilewati: false, berulang: false };
}

// Bentuk geofence yang disimpan/ditandatangani (tanpa objek lokasi lengkap).
export function toGeo(geofence) {
  return {
    dalamRadius: geofence.dalamRadius,
    jarakMeter: geofence.jarakMeter,
    lokasiNama: geofence.location?.nama || null,
  };
}

// Telat = lewat jam masuk + toleransi_menit (0 = tanpa toleransi). Tanpa jadwal -> false.
export function calcStatusTelat(schedule, now) {
  if (!schedule) return false;
  return hitungStatusTelat({
    jamClockIn: jamJakarta(now),
    jamMasuk: schedule.jam_masuk,
    toleransiMenit: schedule.toleransi_menit,
  });
}

// Jumlah hari SEBELUM `tanggal` (dalam jendela) yang baris absensinya sudah ditandai
// wajah_dilewati. Gagal baca -> 0 (penandaan hanya penanda, jangan sampai memblokir
// absen); errornya tetap dicatat.
async function hitungHariWajahDilewati(admin, empId, tanggal) {
  const { count, error } = await admin
    .from('attendance')
    .select('id', { count: 'exact', head: true })
    .eq('employee_id', empId)
    .eq('wajah_dilewati', true)
    .gte('tanggal', geserTanggal(tanggal, -(WAJAH_DILEWATI_JENDELA_HARI - 1)))
    .lt('tanggal', tanggal);
  if (error) {
    console.error('Hitung wajah dilewati gagal:', error);
    return 0;
  }
  return count || 0;
}

// Baca semua bahan hitung server-side dan hitung geofence + wajah.
// Descriptor referensi dibaca DI SINI saja — tidak pernah dikirim ke browser,
// supaya tidak bisa disalin balik untuk memalsukan kecocokan wajah.
//
// Kalau `qr` (teks QR hasil scan) diberikan, absen dianggap via QR: QR diverifikasi server,
// geofence dihitung terhadap lokasi milik QR itu, dan wajah tidak diverifikasi.
// Return-nya membawa `fail` bila QR ditolak.
//
// `accuracy` = coords.accuracy dari browser (meter), dicatat + ditandai review kalau
// buruk/tidak ada. `tanggal` = tanggal Jakarta hari ini, untuk hitung wajah dilewati
// berulang. Keduanya hanya menandai — tidak pernah menggagalkan absen.
export async function evaluateClock(admin, { empId, lat, lng, accuracy, descriptor, tanggal, qr = null }) {
  const akurasi = evaluateGpsAkurasi(accuracy);
  const [scheduleRes, locRes, assignedRes, refRes] = await Promise.all([
    admin.from('work_schedule').select('jam_masuk, jam_pulang, toleransi_menit').eq('employee_id', empId).maybeSingle(),
    admin.from('work_locations').select('*').eq('aktif', true),
    admin.from('employee_work_locations').select('work_location_id').eq('employee_id', empId),
    admin.from('employees').select('foto_referensi_descriptor').eq('id', empId).maybeSingle(),
  ]);

  const relevantLocations = resolveEmployeeLocations(
    locRes.data || [],
    (assignedRes.data || []).map((r) => r.work_location_id)
  );

  if (qr) {
    const resolved = resolveQrLocation(qr, locRes.data || [], relevantLocations);
    if (resolved.fail) return { fail: resolved.fail };
    return {
      schedule: scheduleRes.data,
      scheduleError: scheduleRes.error,
      geofence: checkGeofence(lat, lng, [resolved.location]),
      // QR tidak membawa foto, jadi tidak ada verifikasi wajah (null = tidak mengubah status
      // wajah yang sudah ada dari clock-in/out via foto di hari yang sama).
      wajah: { status: 'qr', ok: null, distance: null, dilewati: false, berulang: false },
      akurasi,
      metode: 'qr',
    };
  }

  const geofence = checkGeofence(lat, lng, relevantLocations);
  const wajah = wajahFrom(refRes.data?.foto_referensi_descriptor || null, descriptor);
  if (wajah.dilewati && tanggal) {
    const hariSebelumnya = await hitungHariWajahDilewati(admin, empId, tanggal);
    wajah.berulang = hariSebelumnya + 1 >= WAJAH_DILEWATI_AMBANG_HARI;
  }

  return { schedule: scheduleRes.data, scheduleError: scheduleRes.error, geofence, wajah, akurasi, metode: 'foto' };
}

// Syarat kondisi hari ini SEBELUM menyimpan. Dipakai preview (supaya karyawan tidak
// diajak konfirmasi sesuatu yang pasti gagal) dan saveClock (penjamin akhir).
// Return { todayRow } (null untuk mode 'in') atau { fail: { status, error } }.
export async function precheckClock(admin, { empId, mode, tanggal }) {
  if (mode === 'in') {
    // Cek dulu sebelum insert supaya pesan errornya jelas. Constraint unique
    // (employee_id, tanggal) di DB tetap jadi penjamin akhir kalau dua request
    // clock-in mendarat bersamaan.
    const { data: existing } = await admin
      .from('attendance')
      .select('id')
      .eq('employee_id', empId)
      .eq('tanggal', tanggal)
      .maybeSingle();
    if (existing) return { fail: { status: 409, error: 'Kamu sudah absen masuk hari ini.' } };
    return { todayRow: null };
  }

  const { data: todayRow } = await admin
    .from('attendance')
    .select('*')
    .eq('employee_id', empId)
    .eq('tanggal', tanggal)
    .maybeSingle();

  if (!todayRow) return { fail: { status: 400, error: 'Belum absen masuk hari ini.' } };
  if (todayRow.clock_out) return { fail: { status: 409, error: 'Kamu sudah absen pulang hari ini.' } };
  // Istirahat harus diakhiri dulu, supaya baris hari itu tidak berakhir dengan
  // break_start tanpa break_end (durasi istirahat jadi tidak bisa dihitung).
  if (todayRow.break_start && !todayRow.break_end) {
    return { fail: { status: 409, error: 'Selesaikan istirahat dulu sebelum absen pulang.' } };
  }
  return { todayRow };
}

// Simpan clock in/out. `now` = instant yang dicatat (jam server saat hitung; untuk
// jalur konfirmasi = jam saat preview). Return { data } atau { fail: { status, error } };
// error tak terduga di-throw (pemanggil membungkus dengan try/catch -> 500).
export async function saveClock(admin, {
  empId, mode, now, tanggal, lat, lng, fotoPath = null, geo, wajah, akurasi, schedule, scheduleError, metode = 'foto',
}) {
  const pre = await precheckClock(admin, { empId, mode, tanggal });
  if (pre.fail) return pre;

  if (mode === 'in') {
    // Kalau jadwal gagal dibaca (mis. migrasi toleransi belum dijalankan),
    // gagalkan clock-in daripada diam-diam mencatat status telat yang salah.
    if (scheduleError) throw scheduleError;

    const isLate = calcStatusTelat(schedule, now);

    const { data, error } = await admin
      .from('attendance')
      .insert([{
        employee_id: empId,
        tanggal,
        clock_in: now.toISOString(),
        clock_in_lat: lat,
        clock_in_lng: lng,
        clock_in_akurasi_meter: akurasi?.meter ?? null,
        clock_in_dalam_radius: geo.dalamRadius,
        clock_in_jarak_meter: geo.jarakMeter,
        clock_in_lokasi_nama: geo.lokasiNama,
        status_telat: isLate,
        // Snapshot toleransi saat clock-in (null kalau belum punya jadwal).
        toleransi_menit: schedule ? Number(schedule.toleransi_menit) || 0 : null,
        foto_clock_in_url: fotoPath,
        clock_in_metode: metode,
        wajah_terverifikasi: wajah.ok,
        wajah_similarity: wajah.distance,
        gps_akurasi_buruk: !!akurasi?.buruk,
        wajah_dilewati: !!wajah.dilewati,
        wajah_dilewati_berulang: !!wajah.berulang,
      }])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Race: dua clock-in mendarat nyaris bersamaan, unique constraint DB
        // yang mencegah baris ganda (bukan pre-check di atas).
        return { fail: { status: 409, error: 'Kamu sudah absen masuk hari ini.' } };
      }
      throw error;
    }
    return { data };
  }

  // mode === 'out'
  const todayRow = pre.todayRow;
  const { data, error } = await admin
    .from('attendance')
    .update({
      clock_out: now.toISOString(),
      clock_out_lat: lat,
      clock_out_lng: lng,
      clock_out_akurasi_meter: akurasi?.meter ?? null,
      clock_out_dalam_radius: geo.dalamRadius,
      clock_out_jarak_meter: geo.jarakMeter,
      clock_out_lokasi_nama: geo.lokasiNama,
      foto_clock_out_url: fotoPath,
      clock_out_metode: metode,
      wajah_terverifikasi: combineWajahStatus(todayRow.wajah_terverifikasi, wajah.ok),
      wajah_similarity: wajah.distance ?? todayRow.wajah_similarity,
      // Penanda review bersifat lengket: sekali ditandai saat clock-in, clock-out
      // yang bersih tidak menghapusnya.
      gps_akurasi_buruk: !!todayRow.gps_akurasi_buruk || !!akurasi?.buruk,
      wajah_dilewati: !!todayRow.wajah_dilewati || !!wajah.dilewati,
      wajah_dilewati_berulang: !!todayRow.wajah_dilewati_berulang || !!wajah.berulang,
    })
    .eq('id', todayRow.id)
    .is('clock_out', null) // cegah dua clock-out mendarat bersamaan menimpa satu sama lain
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) return { fail: { status: 409, error: 'Kamu sudah absen pulang hari ini.' } };
  return { data };
}

// Ringkasan read-only untuk layar review (dikirim ke browser bersama token).
// Semua nilai hasil hitung server; browser hanya menampilkan.
export function buildPreview({ mode, now, tanggal, schedule, statusTelat, geofence, wajah, akurasi, lat, lng, clockInAt = null, metode = 'foto' }) {
  const loc = geofence.location;
  return {
    mode,
    metode,
    tanggal,
    waktu: { iso: now.toISOString(), jam: jamJakarta(now) }, // jam = 'HH:MM:SS' WIB
    jadwal: schedule
      ? {
          jamMasuk: schedule.jam_masuk,
          jamPulang: schedule.jam_pulang ?? null,
          toleransiMenit: Number(schedule.toleransi_menit) || 0,
        }
      : null,
    statusTelat: mode === 'in' ? !!statusTelat : null,
    clockInAt,
    wajah: {
      status: wajah.status,
      cocok: wajah.ok,
      kemiripanPersen: wajah.distance == null ? null : similarityPercent(wajah.distance),
      dilewati: !!wajah.dilewati,
      berulang: !!wajah.berulang,
    },
    lokasi: {
      lat,
      lng,
      akurasiMeter: akurasi?.meter ?? null,
      akurasiBuruk: !!akurasi?.buruk,
      akurasiMaksMeter: GPS_AKURASI_MAKS_METER,
      dalamRadius: geofence.dalamRadius,
      jarakMeter: geofence.jarakMeter,
      nama: loc?.nama || null,
      lokasiLat: loc?.latitude ?? null,
      lokasiLng: loc?.longitude ?? null,
      radiusMeter: loc ? (loc.radius_meter ?? 150) : null,
    },
  };
}

// Validasi fotoPath dari client: lihat resolveFotoRef di lib/attendanceFotoRef.js
// (dulu isValidFotoPath di sini; sekarang foto disimpan di Drive dan referensinya
// bertanda tangan).