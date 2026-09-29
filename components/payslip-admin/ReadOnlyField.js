'use client';

// Task 25 — standing data (rekening, NPWP, PTKP, no. BPJS) sekarang cuma bisa
// dibaca di sini, bukan diinput ulang. Sumbernya employees_master; kalau mau
// ubah, ubah di Payroll Manager, bukan di slip gaji per periode.
export default function ReadOnlyField({ label, value }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[#6B6B6B]">{label}</span>
      <input
        type="text"
        value={value || '— Belum diisi di Payroll Manager —'}
        readOnly
        className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-[#F4F4F4] cursor-not-allowed"
      />
    </label>
  );
}
