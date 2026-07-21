'use client';

import { Loader2 } from 'lucide-react';

export default function LoadingState({ label = 'Memuat data...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-[#9A9A9A]">
      <Loader2 size={22} className="animate-spin mb-3 text-madael-red" />
      <p className="text-sm">{label}</p>
    </div>
  );
}