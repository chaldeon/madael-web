'use client';

import { formatNumberDisplay } from '@/lib/payrollConfig';

export default function NumberField({ label, value, onChange }) {
  const handleChange = (e) => {
    const raw = e.target.value.replace(/[^\d]/g, '');
    onChange(raw === '' ? 0 : Number(raw));
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[#6B6B6B]">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={formatNumberDisplay(value)}
        onChange={handleChange}
        placeholder="0"
        className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
      />
    </label>
  );
}
