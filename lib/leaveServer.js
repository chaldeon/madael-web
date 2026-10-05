// Helper server-only untuk modul Leave Request (dipakai route di
// app/api/leave-requests). Semua fungsi menerima client service role
// (createAdminClient) — jangan import file ini dari komponen client.
import { hitungSisaCuti } from '@/lib/leave';

export function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Jadwal kerja + row employees_master (yang ter-link) untuk satu employee.
// master = null kalau akun belum di-link ke data master (Payroll Manager).
export async function ambilKonteksCuti(admin, employeeId) {
  const [schedRes, masterRes] = await Promise.all([
    admin.from('work_schedule').select('hari_kerja').eq('employee_id', employeeId).maybeSingle(),
    admin
      .from('employees_master')
      .select('id, jatah_cuti_tahunan, cuti_terpakai, cuti_terpakai_tahun')
      .eq('linked_employee_id', employeeId)
      .maybeSingle(),
  ]);

  return {
    error: schedRes.error || masterRes.error || null,
    hariKerja: schedRes.data?.hari_kerja || null,
    master: masterRes.data || null,
  };
}

// Cek apakah rentang tanggal bentrok dengan pengajuan lain milik employee
// yang berstatus pending/approved. excludeId = pengajuan yang sedang diproses.
export async function cariCutiBentrok(admin, { employeeId, tanggalMulai, tanggalSelesai, excludeId = null, statuses = ['pending', 'approved'] }) {
  let q = admin
    .from('leave_requests')
    .select('id, tanggal_mulai, tanggal_selesai, status')
    .eq('employee_id', employeeId)
    .in('status', statuses)
    .lte('tanggal_mulai', tanggalSelesai)
    .gte('tanggal_selesai', tanggalMulai)
    .limit(1);
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q;
  return { error, bentrok: data?.[0] || null };
}

// Ubah cuti_terpakai di employees_master sebesar `delta` hari (negatif =
// kembalikan kuota) dengan compare-and-swap: UPDATE hanya jalan kalau nilai
// cuti_terpakai/cuti_terpakai_tahun masih sama seperti yang barusan dibaca,
// jadi dua approval bersamaan tidak saling menimpa. Dicoba ulang 3x.
//
// `tahun` WAJIB tahun berjalan: counter di master hanya melacak satu tahun
// (lazy reset), jadi menulis tahun lain akan merusak data tahun berjalan.
//
// Return: { ok: true, jatah, terpakai, tahun }
//      atau { ok: false, reason: 'kuota' | 'konflik' | 'error', ... }
export async function ubahKuotaTerpakai(admin, masterId, tahun, delta, { batasiJatah = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: master, error } = await admin
      .from('employees_master')
      .select('id, jatah_cuti_tahunan, cuti_terpakai, cuti_terpakai_tahun')
      .eq('id', masterId)
      .maybeSingle();

    if (error || !master) {
      return { ok: false, reason: 'error', message: error?.message || 'Data master karyawan tidak ditemukan.' };
    }

    const { jatah, terpakai } = hitungSisaCuti(master, tahun);
    const baru = Math.max(0, terpakai + delta);

    if (batasiJatah && baru > jatah) {
      return { ok: false, reason: 'kuota', jatah, sisa: Math.max(0, jatah - terpakai) };
    }

    let q = admin
      .from('employees_master')
      .update({ cuti_terpakai: baru, cuti_terpakai_tahun: tahun })
      .eq('id', masterId);
    q = master.cuti_terpakai === null ? q.is('cuti_terpakai', null) : q.eq('cuti_terpakai', master.cuti_terpakai);
    q = master.cuti_terpakai_tahun === null
      ? q.is('cuti_terpakai_tahun', null)
      : q.eq('cuti_terpakai_tahun', master.cuti_terpakai_tahun);

    const { data: updated, error: updateError } = await q.select('id').maybeSingle();
    if (updateError) return { ok: false, reason: 'error', message: updateError.message };
    if (updated) return { ok: true, jatah, terpakai: baru, tahun };
  }

  return { ok: false, reason: 'konflik' };
}
