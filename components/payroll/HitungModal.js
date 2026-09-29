'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { hitungPPh21TER, hitungBPJS, hitungBrutoPPh21, hitungPenaltyTelat } from '@/lib/payroll/calculations';
import { menitTelatUntukPayroll, isTelatEfektif } from '@/lib/attendanceStatus';
import { totalTunjangan } from '@/lib/payrollConfig';
import NumberField from '@/components/payroll/NumberField';
import { formatRupiah } from '@/lib/format';

export default function HitungModal({ row, periode, onClose }) {
  const supabase = createClient();
  const handleModalBackdrop = useModalDismiss(true, onClose, false);
  const [attSummary, setAttSummary] = useState(null);
  const [attLoading, setAttLoading] = useState(false);
  const [manualOvertime, setManualOvertime] = useState(0);
  const [manualInsentif, setManualInsentif] = useState(0);
  const [manualKompensasi, setManualKompensasi] = useState(0);

  useEffect(() => {
    if (!row.linked_employee_id) {
      setAttSummary(null);
      return;
    }
    let cancelled = false;
    setAttLoading(true);
    const [year, month] = periode.split('-').map(Number);
    const firstDay = `${periode}-01`;
    const lastDayNum = new Date(year, month, 0).getDate();
    const lastDay = `${periode}-${String(lastDayNum).padStart(2, '0')}`;

    Promise.all([
      supabase
        .from('attendance')
        .select('clock_in, status_telat, justified, toleransi_menit')
        .eq('employee_id', row.linked_employee_id)
        .gte('tanggal', firstDay)
        .lte('tanggal', lastDay),
      supabase.from('work_schedule').select('jam_masuk').eq('employee_id', row.linked_employee_id).maybeSingle(),
    ]).then(([{ data }, { data: sched }]) => {
      if (cancelled) return;
      const rows = data || [];
      const totalMenitTelat = sched?.jam_masuk
        ? rows.reduce((sum, r) => sum + menitTelatUntukPayroll(r, sched.jam_masuk), 0)
        : 0;
      setAttSummary({
        totalHadir: rows.filter((r) => r.clock_in).length,
        totalTelat: rows.filter(isTelatEfektif).length,
        totalMenitTelat,
        adaJadwal: !!sched?.jam_masuk,
      });
      setAttLoading(false);
    });

    return () => { cancelled = true; };
  }, [supabase, row.linked_employee_id, periode]);

  const gajiPokok = Number(row.gaji_pokok) || 0; // Gross Salary — basis BPJS
  const allowance = totalTunjangan(row); // tunjangan + komponen lain
  const totalGajiTakeHome = gajiPokok + allowance;
  const totalManual = manualOvertime + manualInsentif + manualKompensasi;
  // Sama seperti totalForBruto di lib/payroll/runSnapshot.js — allowance yang
  // dipakai di rumus Bruto PPh21 ikut Overtime/Insentif/Kompensasi, walaupun
  // "Total Gaji" di atas tetap base-only.
  const totalForBruto = allowance + totalManual;
  const penalty = attSummary?.adaJadwal ? hitungPenaltyTelat(attSummary.totalMenitTelat) : 0;

  const bpjs = row.jkk_rate != null ? hitungBPJS(gajiPokok, row.jkk_rate) : null;
  const brutoPPh21 = bpjs ? hitungBrutoPPh21(gajiPokok, totalForBruto, bpjs, penalty) : null;
  const pph21 = (bpjs && row.status_ptkp) ? hitungPPh21TER(brutoPPh21, row.status_ptkp) : null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] p-4" onClick={handleModalBackdrop}>
      <div className="bg-white w-full max-w-[560px] max-h-[90vh] overflow-y-auto p-8 relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-6 right-6 text-[#6B6B6B] hover:text-black">
          <X size={20} />
        </button>
        <h2 className="text-lg font-semibold text-black mb-1">Preview Hitung — {row.nama}</h2>
        <p className="text-xs text-[#9A9A9A] mb-6">Periode {periode} · belum final run/approval.</p>

        <div className="text-sm mb-6 pb-4 border-b border-[#E0E0E0] flex flex-col gap-1">
          <div className="flex justify-between">
            <span className="text-[#6B6B6B]">Gaji Pokok (Basis BPJS)</span>
            <span className="text-black">{formatRupiah(gajiPokok)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6B6B6B]">Allowance + Komponen Lain</span>
            <span className="text-black">{formatRupiah(allowance)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span className="text-black">Total Gaji</span>
            <span className="text-black">{formatRupiah(totalGajiTakeHome)}</span>
          </div>
        </div>

        <div className="mb-6 pb-4 border-b border-[#E0E0E0]">
          <h3 className="text-sm font-semibold text-black mb-1">Overtime / Insentif / Kompensasi (manual, opsional)</h3>
          <p className="text-[11px] text-[#9A9A9A] mb-2">
            Cuma untuk preview di sini — tidak disimpan. Nilai final tetap diisi nanti di Payroll Run atau Kelola Slip Gaji.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Overtime" value={manualOvertime} onChange={setManualOvertime} />
            <NumberField label="Insentif" value={manualInsentif} onChange={setManualInsentif} />
            <NumberField label="Kompensasi" value={manualKompensasi} onChange={setManualKompensasi} />
          </div>
        </div>

        <div className="mb-6">
          <h3 className="text-sm font-semibold text-black mb-2">PPh21 (TER Bulanan)</h3>
          {pph21 ? (
            <div className="text-sm text-[#6B6B6B] flex flex-col gap-1">
              <div className="flex justify-between"><span>Penalty (Keterlambatan)</span><span className="text-black">− {formatRupiah(penalty)}</span></div>
              <div className="flex justify-between"><span>Bruto PPh21 (Gaji + Overtime/Insentif/Kompensasi + BPJS ditanggung perusahaan − Penalty)</span><span className="text-black">{formatRupiah(brutoPPh21)}</span></div>
              <div className="flex justify-between"><span>Kategori TER</span><span className="text-black">{pph21.category}</span></div>
              <div className="flex justify-between"><span>Tarif</span><span className="text-black">{pph21.rate}%</span></div>
              <div className="flex justify-between font-medium"><span className="text-black">PPh21 Bulanan</span><span className="text-black">{formatRupiah(pph21.pph)}</span></div>
            </div>
          ) : !bpjs ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2">
              Tingkat Risiko JKK employee ini belum diisi — bruto PPh21 butuh BPJS employer dihitung dulu. Buka Edit Employee untuk melengkapi.
            </p>
          ) : (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2">
              Status PTKP employee ini belum diisi — buka Edit Employee untuk melengkapi.
            </p>
          )}
        </div>

        <div className="mb-6">
          <h3 className="text-sm font-semibold text-black mb-2">BPJS</h3>
          {bpjs ? (
            <div className="text-sm text-[#6B6B6B] flex flex-col gap-1">
              <div className="flex justify-between"><span>Tanggungan Perusahaan</span><span className="text-black">{formatRupiah(bpjs.totalEmployer)}</span></div>
              <div className="flex justify-between"><span>Potongan Karyawan</span><span className="text-black">{formatRupiah(bpjs.totalEmployee)}</span></div>
              <div className="flex justify-between font-medium"><span className="text-black">Grand Total BPJS</span><span className="text-black">{formatRupiah(bpjs.grandTotal)}</span></div>
            </div>
          ) : (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2">
              Tingkat Risiko JKK employee ini belum diisi — buka Edit Employee untuk melengkapi.
            </p>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-black mb-2">Referensi Kehadiran</h3>
          {!row.linked_employee_id ? (
            <p className="text-xs text-[#6B6B6B] bg-[#F4F4F4] border border-[#E0E0E0] px-3 py-2">
              Employee ini belum terhubung ke akun Absensi — data kehadiran tidak tersedia. Hubungkan lewat Edit Employee.
            </p>
          ) : attLoading ? (
            <p className="text-xs text-[#9A9A9A]">Memuat data kehadiran...</p>
          ) : (
            <div className="text-sm text-[#6B6B6B] flex flex-col gap-1">
              <div className="flex justify-between"><span>Total Hadir</span><span className="text-black">{attSummary?.totalHadir ?? 0} hari</span></div>
              <div className="flex justify-between"><span>Total Telat</span><span className="text-black">{attSummary?.totalTelat ?? 0} hari</span></div>
              {attSummary?.adaJadwal ? (
                <>
                  <div className="flex justify-between"><span>Total Menit Telat (sebulan)</span><span className="text-black">{attSummary.totalMenitTelat} menit</span></div>
                  <div className="flex justify-between"><span>Penalty Keterlambatan</span><span className="text-black">{formatRupiah(penalty)}</span></div>
                  <p className="text-[11px] text-[#9A9A9A] mt-1">Penalty sudah otomatis masuk ke rumus Bruto PPh21 di atas.</p>
                </>
              ) : (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 mt-1">
                  Employee ini belum punya Jadwal Kerja (jam masuk) — penalty keterlambatan tidak bisa dihitung, dianggap Rp0 untuk sementara.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
