'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function ErrorState({
  message = 'Gagal memuat data. Coba lagi.',
  onRetry,
  retryLabel = 'Coba Lagi',
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 px-6 text-center bg-red-50 border border-red-200">
      <AlertTriangle size={20} className="text-red-600" />
      <p className="text-sm text-red-700">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 bg-madael-red text-white px-5 py-2 text-xs font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
        >
          <RotateCcw size={14} />
          {retryLabel}
        </button>
      )}
    </div>
  );
}