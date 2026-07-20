'use client';

import { Inbox } from 'lucide-react';

export default function EmptyState({ message = 'Belum ada data.', icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 px-6 text-center text-[#9A9A9A]">
      <Icon size={20} className="text-[#C9C9C9]" />
      <p className="text-xs">{message}</p>
    </div>
  );
}