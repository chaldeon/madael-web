// Aturan status Payroll Run — dipakai rute API (penegakan) dan halaman detail
// run. Satu sumber supaya transisi yang sah tidak tersebar di banyak tempat
// (pola yang sama dengan lib/reimbursement.js).

export const PAYROLL_RUN_STATUSES = ['Draft', 'Review', 'Approved'];

// Transisi yang sah: status sekarang -> status tujuan yang boleh.
// 'Approved' sengaja tanpa jalan keluar: begitu disetujui, slip sudah
// digenerate dan terlihat oleh karyawan, jadi status tidak boleh ditarik
// kembali. Koreksi dilakukan lewat Kelola Slip Gaji atau run baru.
export const PAYROLL_RUN_TRANSITIONS = {
  Draft: ['Review', 'Approved'],
  Review: ['Draft', 'Approved'],
};

export function canTransitionPayrollRun(from, to) {
  return (PAYROLL_RUN_TRANSITIONS[from] || []).includes(to);
}

// Pilihan di dropdown "Ubah Status": status sekarang + tujuan yang sah.
export function statusOptionsFor(current) {
  return [current, ...(PAYROLL_RUN_TRANSITIONS[current] || [])];
}

export function pesanTransisiPayrollTidakValid(from, to) {
  if (from === 'Approved') {
    return 'Payroll run yang sudah Approved tidak bisa diubah statusnya.';
  }
  return `Status ${from} tidak bisa langsung diubah ke ${to}.`;
}
