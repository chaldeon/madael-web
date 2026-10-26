// Helper server-only untuk modul Leave Request (dipakai route di
// app/api/leave-requests). Semua fungsi menerima client service role
// (createAdminClient) — jangan import file ini dari komponen client.
import { hitungSisaCuti } from '@/lib/leave';
import { DEFAULT_KEBIJAKAN_CUTI, normalisasiKebijakan } from '@/lib/leavePolicy';
import { friendlyError } from '@/lib/errorMessage';

export function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Kolom employees_master yang dibutuhkan untuk menghitung saldo cuti
// (termasuk tanggal_bergabung & carry-over untuk kebijakan kuota).
export const KOLOM_MASTER_CUTI =
  'id, jatah_cuti_tahunan, cuti_terpakai, cuti_terpakai_tahun, tanggal_bergabung, cuti_carry_over, cuti_carry_over_tahun';

// Kebijakan kuota cuti (tabel leave_policies, satu baris id = 1). Tidak ada
// baris -> DEFAULT_KEBIJAKAN_CUTI (perilaku lama). Error DB dikembalikan, bukan
// diam-diam dipakai default, supaya persetujuan tidak dihitung dengan aturan
// yang salah.
// Return: { error, kebijakan, versi } — versi = updated_at, dipakai sebagai
// compare-and-swap saat kebijakan diubah (app/api/leave-policy).
export async function ambilKebijakanCuti(admin) {
  const { data, error } = await admin
    .from('leave_policies')
    .select('jatah_default, min_masa_kerja_bulan, proporsional_tahun_pertama, carry_over_maks_hari, updated_at')
    .eq('id', 1)
    .maybeSingle();

  if (error) return { error, kebijakan: { ...DEFAULT_KEBIJAKAN_CUTI }, versi: null };
  return { error: null, kebijakan: normalisasiKebijakan(data), versi: data?.updated_at || null };
}

// Jadwal kerja + row employees_master (yang ter-link) untuk satu employee.
// master = null kalau akun belum di-link ke data master (Payroll Manager).
export async function ambilKonteksCuti(admin, employeeId) {
  const [schedRes, masterRes, policyRes] = await Promise.all([
    admin.from('work_schedule').select('hari_kerja').eq('employee_id', employeeId).maybeSingle(),
    admin
      .from('employees_master')
      .select(KOLOM_MASTER_CUTI)
      .eq('linked_employee_id', employeeId)
      .maybeSingle(),
    ambilKebijakanCuti(admin),
  ]);

  return {
    error: schedRes.error || masterRes.error || policyRes.error || null,
    hariKerja: schedRes.data?.hari_kerja || null,
    master: masterRes.data || null,
    kebijakan: policyRes.kebijakan,
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
// Saat counter berganti tahun, carry-over tahun baru (sisa tahun lalu sesuai
// kebijakan) ikut disimpan di update yang sama, sebelum counter lama tertimpa.
// `kebijakan` boleh diberikan pemanggil (ctx.kebijakan) supaya tidak dibaca ulang.
//
// Return: { ok: true, jatah, terpakai, tahun, carry: { cuti_carry_over, cuti_carry_over_tahun } }
//      atau { ok: false, reason: 'kuota' | 'konflik' | 'error', ... }
//      ('kuota' menyertakan jatah, sisa, belumBerhak, berhakMulai)
export async function ubahKuotaTerpakai(admin, masterId, tahun, delta, { batasiJatah = false, kebijakan = null } = {}) {
  let aturan = kebijakan;
  if (!aturan) {
    const pol = await ambilKebijakanCuti(admin);
    if (pol.error) {
      return { ok: false, reason: 'error', error: pol.error, message: friendlyError(pol.error, 'Gagal memuat kebijakan cuti.') };
    }
    aturan = pol.kebijakan;
  }

  // Tambahkan filter "sama dengan nilai yang tadi dibaca" (NULL perlu .is).
  const samaDengan = (q, kolom, nilai) => (nilai === null || nilai === undefined ? q.is(kolom, null) : q.eq(kolom, nilai));

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: master, error } = await admin
      .from('employees_master')
      .select(KOLOM_MASTER_CUTI)
      .eq('id', masterId)
      .maybeSingle();

    if (error || !master) {
      return { ok: false, reason: 'error', error: error || null, message: friendlyError(error, 'Data master karyawan tidak ditemukan.') };
    }

    const saldo = hitungSisaCuti(master, tahun, aturan);
    const { jatah, terpakai } = saldo;
    const baru = Math.max(0, terpakai + delta);

    if (batasiJatah && baru > jatah) {
      return {
        ok: false, reason: 'kuota', jatah, sisa: Math.max(0, jatah - terpakai),
        belumBerhak: saldo.belumBerhak, berhakMulai: saldo.berhakMulai,
      };
    }

    const patch = { cuti_terpakai: baru, cuti_terpakai_tahun: tahun };
    const gantiTahun = master.cuti_terpakai_tahun !== tahun;
    if (gantiTahun) {
      patch.cuti_carry_over = saldo.carryOver;
      patch.cuti_carry_over_tahun = tahun;
    }

    let q = admin.from('employees_master').update(patch).eq('id', masterId);
    q = samaDengan(q, 'cuti_terpakai', master.cuti_terpakai);
    q = samaDengan(q, 'cuti_terpakai_tahun', master.cuti_terpakai_tahun);
    if (gantiTahun) q = samaDengan(q, 'cuti_carry_over_tahun', master.cuti_carry_over_tahun);

    const { data: updated, error: updateError } = await q.select('id').maybeSingle();
    if (updateError) return { ok: false, reason: 'error', error: updateError, message: updateError.message };
    if (updated) {
      return {
        ok: true, jatah, terpakai: baru, tahun,
        carry: gantiTahun
          ? { cuti_carry_over: saldo.carryOver, cuti_carry_over_tahun: tahun }
          : { cuti_carry_over: master.cuti_carry_over ?? 0, cuti_carry_over_tahun: master.cuti_carry_over_tahun ?? null },
      };
    }
  }

  return { ok: false, reason: 'konflik' };
}
