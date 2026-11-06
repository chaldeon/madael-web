// SERVER ONLY — hitung SARAN nominal Overtime Payroll Run dari lembur yang sudah
// disetujui pada satu periode. `admin` WAJIB client service role.
//
// Dipakai oleh:
//  - GET   /api/payroll/overtime-suggestion      (hanya melihat saran)
//  - PATCH /api/payroll/runs/[runId]/items        (menyimpan saran ke semua item)
// Satu sumber hitungan supaya angka yang dilihat dan yang disimpan tidak bisa
// berbeda.
//
// Per karyawan yang akun absensinya terhubung ke employees_master
// (linked_employee_id): total jam disetujui dan nominalnya, dengan aturan yang
// sama dengan kalkulator publik (lib/overtimeRules.js). Asumsi: upah sebulan =
// gaji_pokok + tunjangan (komponen_lain TIDAK ikut), upah per jam = 1/173 ×
// upah sebulan. Jam dikelompokkan per tanggal + jenis hari supaya pengali
// berurutan (jam ke-1, ke-2, ...) dihitung per hari.

import { fetchAllRows } from '@/lib/fetchAllRows';
import { batasPeriode, hitungUpahLembur, upahPerJamDariSebulan } from '@/lib/overtimeRules';

// Return { suggestions, tidakTerhubung } atau { error } (error = teks aman
// untuk ditampilkan). suggestions: [{ employee_master_id, client_id,
// linked_employee_id, total_jam, nominal }].
export async function hitungSaranLembur(admin, periode) {
  const { awal, awalBulanDepan } = batasPeriode(periode);

  // Dipaginasi: lembur disetujui sebulan untuk semua klien bisa lewat 1.000
  // baris, dan saran yang terpotong diam-diam kini ikut tersimpan.
  const { data: rows, error } = await fetchAllRows(() =>
    admin
      .from('overtime_requests')
      .select('employee_id, tanggal, durasi_menit, jam_disetujui, jenis_hari')
      .eq('status', 'approved')
      .gte('tanggal', awal)
      .lt('tanggal', awalBulanDepan)
  );
  if (error) {
    console.error('Saran lembur payroll — muat lembur error:', error);
    return { error: 'Gagal memuat lembur yang disetujui.' };
  }
  if (!rows || rows.length === 0) {
    return { suggestions: [], tidakTerhubung: [] };
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
      .select('id, client_id, linked_employee_id, gaji_pokok, tunjangan')
      .in('linked_employee_id', employeeIds),
    admin.from('employees').select('id, nama').in('id', employeeIds),
  ]);
  if (masterRes.error || empRes.error) {
    console.error('Saran lembur payroll — muat master error:', masterRes.error || empRes.error);
    return { error: 'Gagal memuat data karyawan untuk saran lembur.' };
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
      client_id: master.client_id,
      linked_employee_id: employeeId,
      total_jam: totalJam,
      nominal,
    });
  }

  return { suggestions, tidakTerhubung };
}
