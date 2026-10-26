import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { todayJakarta, jamJakarta } from '@/lib/serverTime';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { friendlyError } from '@/lib/errorMessage';
import { labelJenisCuti } from '@/lib/leave';
import {
  KEHADIRAN_MODULES,
  KEHADIRAN_KINDS,
  namaHari,
  jamJakartaDariIso,
  klasifikasiKehadiran,
  hitungPerKind,
} from '@/lib/kehadiranHariIni';

// GET /api/dashboard/kehadiran-hari-ini
//
// Monitor kehadiran hari ini untuk HR: siapa yang belum clock-in, telat, cuti,
// atau sudah hadir. Menggabungkan tiga sumber di server, semuanya memakai
// tanggal & jam Jakarta (server Vercel berjalan di UTC):
//   - work_schedule : hari kerja, jam masuk, toleransi
//   - attendance    : clock-in hari ini
//   - leave_requests: cuti berstatus approved yang mencakup hari ini
// Identitas karyawan dari employees_master (sumber kebenaran); hanya yang punya
// akun aktif (linked_employee_id) yang ikut, karena hanya mereka yang bisa
// clock-in. Baris payroll-only tidak dihitung.
//
// Hak akses: KEHADIRAN_MODULES (superadmin lolos). absensi_admin sendiri
// superadminOnly, makanya HR non-superadmin dilewatkan lewat modul lain.
// Query memakai service role (RLS tidak berlaku), jadi hak dicek manual dan
// kolom yang dikirim dibatasi: tidak ada data gaji, foto, atau lokasi GPS.
//
// Respons: { today, jam, hari, counts, wajibMasuk, items: [...] } — `items`
// berisi kind hadir/telat/belum_clock_in/menunggu/cuti saja, urut menurut
// KEHADIRAN_KINDS lalu nama. counts juga memuat libur & tanpa_jadwal.
export async function GET() {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, KEHADIRAN_MODULES);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    // Satu instant untuk tanggal & jam, supaya tidak beda hari di sekitar tengah malam.
    const now = new Date();
    const today = todayJakarta(now);
    const jamSekarang = jamJakarta(now);
    const hariIni = namaHari(today);

    const [empRes, schedRes, attRes, leaveRes] = await Promise.all([
      fetchAllRows(() =>
        admin
          .from('employees_master')
          .select(
            'id, nama, posisi, linked_employee_id, employees:linked_employee_id ( id, status ), companies:client_id ( nama_perusahaan )'
          )
          .not('linked_employee_id', 'is', null)
      ),
      fetchAllRows(() =>
        admin.from('work_schedule').select('id, employee_id, jam_masuk, hari_kerja, toleransi_menit')
      ),
      fetchAllRows(() =>
        admin
          .from('attendance')
          .select('id, employee_id, clock_in, status_telat, justified')
          .eq('tanggal', today)
      ),
      fetchAllRows(() =>
        admin
          .from('leave_requests')
          .select('id, employee_id, jenis')
          .eq('status', 'approved')
          .lte('tanggal_mulai', today)
          .gte('tanggal_selesai', today)
      ),
    ]);

    const firstError = empRes.error || schedRes.error || attRes.error || leaveRes.error;
    if (firstError) {
      return NextResponse.json(
        { error: `Gagal memuat kehadiran hari ini: ${friendlyError(firstError, 'terjadi kesalahan pada server.', { context: 'Muat kehadiran hari ini' })}` },
        { status: 500 }
      );
    }

    const scheduleByEmp = new Map(schedRes.data.map((s) => [s.employee_id, s]));
    // Kalau ada lebih dari satu baris di hari yang sama, yang sudah clock-in menang.
    const attByEmp = new Map();
    attRes.data.forEach((a) => {
      const prev = attByEmp.get(a.employee_id);
      if (!prev || (!prev.clock_in && a.clock_in)) attByEmp.set(a.employee_id, a);
    });
    const leaveByEmp = new Map(leaveRes.data.map((l) => [l.employee_id, l]));

    const all = empRes.data
      // Akun yang sudah dinonaktifkan tidak dipantau.
      .filter((r) => r.employees && r.employees.status === 'Aktif')
      .map((r) => {
        const empId = r.linked_employee_id;
        const attendance = attByEmp.get(empId) || null;
        const cuti = leaveByEmp.get(empId) || null;
        const kind = klasifikasiKehadiran({
          hariIni,
          jamSekarang,
          schedule: scheduleByEmp.get(empId) || null,
          attendance,
          cuti,
        });
        return {
          id: r.id,
          nama: r.nama,
          posisi: r.posisi || null,
          perusahaan: r.companies?.nama_perusahaan || null,
          kind,
          clock_in: jamJakartaDariIso(attendance?.clock_in),
          jenis_cuti: kind === 'cuti' ? labelJenisCuti(cuti?.jenis) : null,
        };
      });

    const counts = hitungPerKind(all);
    const items = all
      .filter((i) => KEHADIRAN_KINDS.includes(i.kind))
      .sort(
        (a, b) =>
          KEHADIRAN_KINDS.indexOf(a.kind) - KEHADIRAN_KINDS.indexOf(b.kind) ||
          String(a.nama || '').localeCompare(String(b.nama || ''), 'id')
      );

    return NextResponse.json(
      {
        today,
        jam: jamSekarang.slice(0, 5),
        hari: hariIni,
        counts,
        // Karyawan yang hari ini wajib masuk (tidak termasuk cuti/libur/tanpa jadwal).
        wajibMasuk: counts.belum_clock_in + counts.telat + counts.menunggu + counts.hadir,
        items,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('Muat kehadiran hari ini error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
