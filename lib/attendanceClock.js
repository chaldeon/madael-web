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
export function wajahFrom(referensi, descriptor) {
  if (referensi && Array.isArray(descriptor)) {
    const raw = descriptorDistance(descriptor, referensi);
    const ok = isFaceMatch(raw);
    // Infinity/NaN (descriptor tidak sepanjang referensi, dst) tidak bisa disimpan
    // sebagai angka; JSON.stringify sudah mengubahnya jadi null di route lama.
    const distance = Number.isFinite(raw) ? raw : null;
    return { status: ok ? 'cocok' : 'tidak_cocok', ok, distance };
  }
  if (referensi && descriptor === null) {
    // Kamera sempat jalan tapi wajah tidak terdeteksi jelas — beda dari "belum
    // sempat dicoba" (descriptor tidak dikirim sama sekali), yang dianggap
    // "belum bisa dicek" (null), bukan gagal.
    return { status: 'tidak_terdeteksi', ok: false, distance: null };
  }
  if (referensi) return { status: 'belum_dicek', ok: null, distance: null };
  return { status: 'tanpa_referensi', ok: null, distance: null };
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

// Baca semua bahan hitung server-side dan hitung geofence + wajah.
// Descriptor referensi dibaca DI SINI saja — tidak pernah dikirim ke browser,
// supaya tidak bisa disalin balik untuk memalsukan kecocokan wajah.
export async function evaluateClock(admin, { empId, lat, lng, descriptor }) {
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
  const geofence = checkGeofence(lat, lng, relevantLocations);
  const wajah = wajahFrom(refRes.data?.foto_referensi_descriptor || null, descriptor);

  return { schedule: scheduleRes.data, scheduleError: scheduleRes.error, geofence, wajah };
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
  return { todayRow };
}

// Simpan clock in/out. `now` = instant yang dicatat (jam server saat hitung; untuk
// jalur konfirmasi = jam saat preview). Return { data } atau { fail: { status, error } };
// error tak terduga di-throw (pemanggil membungkus dengan try/catch -> 500).
export async function saveClock(admin, {
  empId, mode, now, tanggal, lat, lng, fotoPath = null, geo, wajah, schedule, scheduleError,
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
        clock_in_dalam_radius: geo.dalamRadius,
        clock_in_jarak_meter: geo.jarakMeter,
        clock_in_lokasi_nama: geo.lokasiNama,
        status_telat: isLate,
        // Snapshot toleransi saat clock-in (null kalau belum punya jadwal).
        toleransi_menit: schedule ? Number(schedule.toleransi_menit) || 0 : null,
        foto_clock_in_url: fotoPath,
        wajah_terverifikasi: wajah.ok,
        wajah_similarity: wajah.distance,
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
      clock_out_dalam_radius: geo.dalamRadius,
      clock_out_jarak_meter: geo.jarakMeter,
      clock_out_lokasi_nama: geo.lokasiNama,
      foto_clock_out_url: fotoPath,
      wajah_terverifikasi: combineWajahStatus(todayRow.wajah_terverifikasi, wajah.ok),
      wajah_similarity: wajah.distance ?? todayRow.wajah_similarity,
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
export function buildPreview({ mode, now, tanggal, schedule, statusTelat, geofence, wajah, lat, lng, clockInAt = null }) {
  const loc = geofence.location;
  return {
    mode,
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
    },
    lokasi: {
      lat,
      lng,
      dalamRadius: geofence.dalamRadius,
      jarakMeter: geofence.jarakMeter,
      nama: loc?.nama || null,
      lokasiLat: loc?.latitude ?? null,
      lokasiLng: loc?.longitude ?? null,
      radiusMeter: loc ? (loc.radius_meter ?? 150) : null,
    },
  };
}

// fotoPath dari client HARUS ada di folder milik karyawan itu sendiri
// (`${employee.id}/...` — sama dengan path upload di halaman Absensi), supaya
// tidak bisa menempelkan foto milik orang lain sebagai bukti absensi.
export function isValidFotoPath(fotoPath, empId) {
  if (fotoPath === null || fotoPath === undefined) return true;
  if (typeof fotoPath !== 'string' || fotoPath.length > 300) return false;
  if (fotoPath.includes('..')) return false;
  return fotoPath.startsWith(`${empId}/`);
}