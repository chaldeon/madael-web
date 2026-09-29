'use client';

import { useEffect, useState } from 'react';
import { formatRibuan } from '@/lib/payslipAdminConfig';

export default function NumberField({ label, value, onChange }) {
  const [display, setDisplay] = useState(formatRibuan(value));

  useEffect(() => {
    setDisplay(formatRibuan(value));
  }, [value]);

  const handleChange = (e) => {
    const digitsOnly = e.target.value.replace(/\D/g, '');
    const num = digitsOnly === '' ? 0 : Number(digitsOnly);
    setDisplay(digitsOnly === '' ? '' : num.toLocaleString('id-ID'));
    onChange(num);
  };

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[#6B6B6B]">{label}</span>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9A9A9A]">Rp</span>
        <input
          type="text"
          inputMode="numeric"
          value={display}
          onChange={handleChange}
          placeholder="0"
          className="w-full border border-[#E0E0E0] pl-9 pr-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
        />
      </div>
    </label>
  );
}
