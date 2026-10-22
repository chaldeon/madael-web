'use client';

// Input tanggal (YYYY-MM-DD) bergaya sama dengan TextField/SelectField.
export default function DateField({ label, value, onChange, disabled = false, hint }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[#6B6B6B]">{label}</span>
      <input
        type="date"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors disabled:bg-[#F4F4F4] disabled:text-[#9A9A9A]"
      />
      {hint && <span className="text-[11px] text-[#9A9A9A]">{hint}</span>}
    </label>
  );
}
