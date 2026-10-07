import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { batasPeriode, hitungUpahLembur, upahPerJamDariSebulan } from '@/lib/overtimeRules';

// GET /api/payroll/overtime-suggestion?periode=YYYY-MM
// SARAN nominal Overtime untuk Payroll Run dari lembur yang sudah disetujui
// pada periode itu. Tidak menulis apa pun ke payroll — halaman Payroll Run
// hanya mengisi kolom edit di layar, dan admin tetap menyimpannya sendiri.
//
// Per karyawan yang akun absensinya terhubung ke employees_master
// (linked_employee_id): total jam disetujui dan nominalnya, dihitung server
// dengan aturan yang sama dengan kalkulator publik (lib/overtimeRules.js).
// Asumsi: upah sebulan = gaji_pokok + tunjangan (komponen_lain TIDAK ikut),
// upah per jam = 1/173 × upah sebulan. Jam dikelompokkan per tanggal + jenis
// hari supaya pengali berurutan (jam ke-1, ke-2, ...) dihitung per hari.
// Hanya angka hasil yang dikirim; gaji pokok/tunjangan tidak ikut di respons.
export async function GET(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const periode = new URL(request.url).searchParams.get('periode') || '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) {
      return NextResponse.json({ error: 'Format periode harus YYYY-MM.' }, { status: 400 });
    }
    const { awal, awalBulanDepan } = batasPeriode(periode);

    const { data: rows, error } = await admin
      .from('overtime_requests')
      .select('employee_id, tanggal, durasi_menit, jam_disetujui, jenis_hari')
      .eq('status', 'approved')
      .gte('tanggal', awal)
      .lt('tanggal', awalBulanDepan);
    if (error) {
      console.error('Saran lembur payroll — muat lembur error:', error);
      return NextResponse.json({ error: 'Gagal memuat lembur yang disetujui.' }, { status: 500 });
    }
    if (!rows || rows.length === 0) {
      return NextResponse.json({ periode, suggestions: [], tidak_terhubung: [] });
    }

    // Jam per karyawan, per (tanggal + jenis hari).
    const perKaryawan = new Map();
    for (const r of rows) {
      const jam = r.jam_disetujui !== null && r.jam_disetujui !== undefined
        ? Number(r.jam_disetujui)
        : r.durasi_menit / 60;
      const hari = perKaryawan.get(r.employee_id) || new Map();
      const kunci = `${r.tanggal}|${r.jenis_hari}`;
      hari.set(kunci, { jenisHari: r.jenis_hari, jam: (hari.get(kunci)?.jam || 0) + jam });
      perKaryawan.set(r.employee_id, hari);
    }

    const employeeIds = Array.from(perKaryawan.keys());
    const [masterRes, empRes] = await Promise.all([
      admin
        .from('employees_master')
        .select('id, linked_employee_id, gaji_pokok, tunjangan')
        .in('linked_employee_id', employeeIds),
      admin.from('employees').select('id, nama').in('id', employeeIds),
    ]);
    if (masterRes.error || empRes.error) {
      console.error('Saran lembur payroll — muat master error:', masterRes.error || empRes.error);
      return NextResponse.json({ error: 'Gagal memuat data karyawan untuk saran lembur.' }, { status: 500 });
    }

    const masterByEmployee = new Map((masterRes.data || []).map((m) => [m.linked_employee_id, m]));
    const namaById = Object.fromEntries((empRes.data || []).map((e) => [e.id, e.nama]));

    const suggestions = [];
    const tidakTerhubung = [];
    for (const [employeeId, hari] of perKaryawan) {
      const grup = Array.from(hari.values());
      const totalJam = Math.round(grup.reduce((s, g) => s + g.jam, 0) * 100) / 100;
      const master = masterByEmployee.get(employeeId);
      if (!master) {
        tidakTerhubung.push({ employee_id: employeeId, nama: namaById[employeeId] || '—', total_jam: totalJam });
        continue;
      }
      const upahPerJam = upahPerJamDariSebulan((Number(master.gaji_pokok) || 0) + (Number(master.tunjangan) || 0));
      const nominal = Math.round(grup.reduce((s, g) => s + hitungUpahLembur(g.jenisHari, g.jam, upahPerJam), 0));
      suggestions.push({
        employee_master_id: master.id,
        linked_employee_id: employeeId,
        total_jam: totalJam,
        nominal,
      });
    }

    return NextResponse.json({ periode, suggestions, tidak_terhubung: tidakTerhubung });
  } catch (err) {
    console.error('Saran lembur payroll error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
