import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { checkGeofence, resolveEmployeeLocations } from '@/lib/geofence';
import { descriptorDistance, isFaceMatch } from '@/lib/faceVerification';
import { todayJakarta, jamJakarta } from '@/lib/serverTime';
import { hitungStatusTelat } from '@/lib/attendanceStatus';

// Gabungkan hasil verifikasi wajah clock-in & clock-out: kalau salah satu
// gagal cocok, hasil akhirnya dianggap gagal (perlu review) — bukan ditimpa
// jadi "berhasil" cuma karena yang satunya kebetulan cocok. (Dipindah dari
// app/employee/absensi/page.js — logikanya sama persis.)
function combineWajahStatus(a, b) {
  if (a === false || b === false) return false;
  if (a === true || b === true) return true;
  return null;
}

// POST /api/attendance/clock
// Clock in/out karyawan. SEMUA nilai yang menentukan kebenaran absensi — jam,
// tanggal, status telat, jarak geofence, dan verifikasi wajah — dihitung DI
// SINI, bukan dipercaya dari browser. Client hanya mengirim bahan mentah:
// koordinat GPS, path foto yang sudah diupload ke storage, dan descriptor
// wajah (128 angka) hasil deteksi dari frame kamera — bukan kesimpulan
// cocok/tidaknya, dan bukan flag radius/telat.
//
// body: {
//   mode: 'in' | 'out',
//   lat: number, lng: number,
//   fotoPath: string | null,
//   descriptor: number[] | null | undefined
//     - array   : wajah terdeteksi di frame, ini descriptor-nya
//     - null    : kamera sempat jalan tapi wajah tidak terdeteksi jelas
//     - (absen) : deteksi tidak sempat dicoba (model gagal dimuat, dll)
// }
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 });
    }
    const { mode, lat, lng, fotoPath = null, descriptor } = body;

    if (mode !== 'in' && mode !== 'out') {
      return NextResponse.json({ error: 'mode harus "in" atau "out".' }, { status: 400 });
    }
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { error: 'Lokasi tidak valid. Pastikan izin lokasi diaktifkan lalu coba lagi.' },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll() {
            // no-op — route ini cuma butuh baca session
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum login.' }, { status: 401 });
    }

    const { data: emp } = await supabase
      .from('employees')
      .select('id, status')
      .eq('email', user.email)
      .maybeSingle();

    if (!emp || emp.status !== 'Aktif') {
      return NextResponse.json({ error: 'Akun tidak aktif.' }, { status: 403 });
    }

    const admin = createAdminClient();
    const now = new Date();
    const tanggal = todayJakarta(now);

    const [scheduleRes, locRes, assignedRes, refRes] = await Promise.all([
      admin.from('work_schedule').select('jam_masuk, toleransi_menit').eq('employee_id', emp.id).maybeSingle(),
      admin.from('work_locations').select('*').eq('aktif', true),
      admin.from('employee_work_locations').select('work_location_id').eq('employee_id', emp.id),
      // Descriptor referensi dibaca DI SINI saja — tidak pernah dikirim ke
      // browser (lihat app/employee/absensi/page.js), supaya tidak bisa
      // disalin balik dan dikirim sebagai "descriptor hasil capture" untuk
      // memalsukan kecocokan wajah.
      admin.from('employees').select('foto_referensi_descriptor').eq('id', emp.id).maybeSingle(),
    ]);

    const relevantLocations = resolveEmployeeLocations(
      locRes.data || [],
      (assignedRes.data || []).map((r) => r.work_location_id)
    );
    const geofence = checkGeofence(lat, lng, relevantLocations);

    const referensiWajah = refRes.data?.foto_referensi_descriptor || null;
    let wajahTerverifikasi = null;
    let wajahSimilarity = null;
    if (referensiWajah && Array.isArray(descriptor)) {
      const distance = descriptorDistance(descriptor, referensiWajah);
      wajahSimilarity = distance;
      wajahTerverifikasi = isFaceMatch(distance);
    } else if (referensiWajah && descriptor === null) {
      // Kamera sempat jalan tapi wajah tidak terdeteksi jelas — beda dari
      // "belum sempat dicoba" (descriptor tidak dikirim sama sekali), yang
      // tetap dianggap "belum bisa dicek" (null), bukan gagal.
      wajahTerverifikasi = false;
    }

    if (mode === 'in') {
      // Cek dulu sebelum insert supaya pesan errornya jelas. Constraint
      // unique (employee_id, tanggal) di DB (lihat migrasi terlampir) tetap
      // jadi penjamin akhir kalau dua request clock-in mendarat bersamaan.
      const { data: existing } = await admin
        .from('attendance')
        .select('id')
        .eq('employee_id', emp.id)
        .eq('tanggal', tanggal)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ error: 'Kamu sudah absen masuk hari ini.' }, { status: 409 });
      }

      // Kalau jadwal gagal dibaca (mis. migrasi toleransi belum dijalankan),
      // gagalkan clock-in daripada diam-diam mencatat status telat yang salah.
      if (scheduleRes.error) throw scheduleRes.error;

      // Telat = lewat jam masuk + toleransi_menit (0 = tanpa toleransi).
      // Dihitung sekali saat clock-in; tidak pernah dihitung ulang ke data lama.
      const isLate = scheduleRes.data
        ? hitungStatusTelat({
            jamClockIn: jamJakarta(now),
            jamMasuk: scheduleRes.data.jam_masuk,
            toleransiMenit: scheduleRes.data.toleransi_menit,
          })
        : false;

      const { data, error } = await admin
        .from('attendance')
        .insert([{
          employee_id: emp.id,
          tanggal,
          clock_in: now.toISOString(),
          clock_in_lat: lat,
          clock_in_lng: lng,
          clock_in_dalam_radius: geofence.dalamRadius,
          clock_in_jarak_meter: geofence.jarakMeter,
          clock_in_lokasi_nama: geofence.location?.nama || null,
          status_telat: isLate,
          // Snapshot toleransi saat clock-in (null kalau belum punya jadwal).
          toleransi_menit: scheduleRes.data ? Number(scheduleRes.data.toleransi_menit) || 0 : null,
          foto_clock_in_url: fotoPath,
          wajah_terverifikasi: wajahTerverifikasi,
          wajah_similarity: wajahSimilarity,
        }])
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          // Race: dua clock-in mendarat nyaris bersamaan, unique constraint DB
          // yang mencegah baris ganda (bukan pre-check di atas).
          return NextResponse.json({ error: 'Kamu sudah absen masuk hari ini.' }, { status: 409 });
        }
        throw error;
      }
      return NextResponse.json({ data });
    }

    // mode === 'out'
    const { data: todayRow } = await admin
      .from('attendance')
      .select('*')
      .eq('employee_id', emp.id)
      .eq('tanggal', tanggal)
      .maybeSingle();

    if (!todayRow) {
      return NextResponse.json({ error: 'Belum absen masuk hari ini.' }, { status: 400 });
    }
    if (todayRow.clock_out) {
      return NextResponse.json({ error: 'Kamu sudah absen pulang hari ini.' }, { status: 409 });
    }

    const { data, error } = await admin
      .from('attendance')
      .update({
        clock_out: now.toISOString(),
        clock_out_lat: lat,
        clock_out_lng: lng,
        clock_out_dalam_radius: geofence.dalamRadius,
        clock_out_jarak_meter: geofence.jarakMeter,
        clock_out_lokasi_nama: geofence.location?.nama || null,
        foto_clock_out_url: fotoPath,
        wajah_terverifikasi: combineWajahStatus(todayRow.wajah_terverifikasi, wajahTerverifikasi),
        wajah_similarity: wajahSimilarity ?? todayRow.wajah_similarity,
      })
      .eq('id', todayRow.id)
      .is('clock_out', null) // cegah dua clock-out mendarat bersamaan menimpa satu sama lain
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Kamu sudah absen pulang hari ini.' }, { status: 409 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('Clock in/out error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat menyimpan absensi.' }, { status: 500 });
  }
}