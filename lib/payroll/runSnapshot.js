// Hitung snapshot payroll satu employees_master row untuk satu periode.
// Logic-nya sama persis dengan HitungModal di app/employee/payroll/page.js
// (dan app/employee/payslip/admin/page.js) supaya angka yang di-generate
// payroll run konsisten dengan preview "Hitung" yang sudah ada — cuma di
// sini hasilnya di-persist ke payroll_run_items, bukan cuma preview.

import { hitungBPJS, hitungBrutoPPh21, hitungPPh21TER, hitungPenaltyTelat } from './calculations';

// Sama persis dengan menitTelat() di employee/payroll & employee/payslip/admin.
function menitTelat(clockInIso, jamMasuk) {
  if (!clockInIso || !jamMasuk) return 0;
  const d = new Date(clockInIso);
  const clockMinutes = d.getHours() * 60 + d.getMinutes();
  const [jh, jm] = jamMasuk.split(':').map(Number);
  const jamMasukMinutes = jh * 60 + jm;
  return Math.max(0, clockMinutes - jamMasukMinutes);
}

function totalTunjangan(row) {
  const komponenTotal = Object.values(row.komponen_lain || {}).reduce(
    (sum, v) => sum + (Number(v) || 0),
    0
  );
  return (Number(row.tunjangan) || 0) + komponenTotal;
}

// row: satu baris employees_master (butuh gaji_pokok, tunjangan, komponen_lain,
// linked_employee_id, status_ptkp, jkk_rate).
// periode: 'YYYY-MM'.
// Return: snapshot angka siap disimpan ke payroll_run_items, plus flag
// `incomplete` kalau JKK/PTKP belum diisi (dipakai untuk warning di UI —
// run tetap dibuat, tapi ditandai perlu dilengkapi).
export async function computeSnapshot(supabase, row, periode) {
  const gajiPokok = Number(row.gaji_pokok) || 0;
  const allowance = totalTunjangan(row);

  let penalty = 0;
  let adaJadwal = false;

  if (row.linked_employee_id) {
    const [year, month] = periode.split('-').map(Number);
    const firstDay = `${periode}-01`;
    const lastDayNum = new Date(year, month, 0).getDate();
    const lastDay = `${periode}-${String(lastDayNum).padStart(2, '0')}`;

    const [attRes, schedRes] = await Promise.all([
      supabase
        .from('attendance')
        .select('clock_in, status_telat')
        .eq('employee_id', row.linked_employee_id)
        .gte('tanggal', firstDay)
        .lte('tanggal', lastDay),
      supabase.from('work_schedule').select('jam_masuk').eq('employee_id', row.linked_employee_id).maybeSingle(),
    ]);

    const attRows = attRes.data || [];
    const sched = schedRes.data;
    adaJadwal = !!sched?.jam_masuk;
    if (adaJadwal) {
      const totalMenitTelat = attRows.reduce((sum, r) => sum + menitTelat(r.clock_in, sched.jam_masuk), 0);
      penalty = hitungPenaltyTelat(totalMenitTelat);
    }
  }

  const bpjs = row.jkk_rate != null ? hitungBPJS(gajiPokok, row.jkk_rate) : null;
  const brutoPPh21 = bpjs ? hitungBrutoPPh21(gajiPokok, allowance, bpjs, penalty) : null;
  const pph21Result = (bpjs && row.status_ptkp) ? hitungPPh21TER(brutoPPh21, row.status_ptkp) : null;
  // PPh21 dibulatkan floor — konvensi resmi TER, sama seperti payslip admin.
  const pph21 = pph21Result ? Math.floor(pph21Result.pph) : 0;

  const bpjsEmployer = bpjs ? bpjs.totalEmployer : 0;
  const bpjsEmployee = bpjs ? bpjs.totalEmployee : 0;
  const takeHomePay = gajiPokok + allowance - penalty - bpjsEmployee - pph21;

  return {
    employee_master_id: row.id,
    gaji_pokok: gajiPokok,
    allowance,
    penalty: Math.round(penalty),
    bpjs_employer: Math.round(bpjsEmployer),
    bpjs_employee: Math.round(bpjsEmployee),
    pph21,
    take_home_pay: Math.round(takeHomePay),
    incomplete: !bpjs || !pph21Result,
  };
}