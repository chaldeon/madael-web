'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

// Tampilan fallback untuk error tak terduga (dipakai app/error.js,
// app/employee/error.js, dan app/global-error.js) supaya user tidak melihat
// halaman error default Next.js. `reset` = fungsi dari Next untuk mencoba
// render ulang segmen yang error. `digest` adalah kode error dari server
// (pesan aslinya sengaja disembunyikan Next di production) — berguna untuk
// dicocokkan dengan log server kalau user melapor.
export default function RouteError({
  error,
  reset,
  homeHref = '/',
  homeLabel = 'Kembali ke Beranda',
  fullScreen = false,
}) {
  useEffect(() => {
    console.error('Route error:', error);
  }, [error]);

  return (
    <section
      className={`${fullScreen ? 'min-h-screen' : 'min-h-[60vh]'} flex items-center justify-center bg-[#F4F4F4] px-6 py-16`}
    >
      <div className="w-full max-w-[440px] border-t-4 border-madael-red bg-white p-8 text-center">
        <AlertTriangle size={26} className="mx-auto mb-4 text-madael-red" />
        <h1 className="text-base font-medium text-black mb-2">Terjadi kesalahan</h1>
        <p className="text-sm text-[#6B6B6B] mb-6">
          Halaman ini gagal dimuat. Coba lagi, dan kalau masih berulang, hubungi tim developer.
        </p>
        {error?.digest && (
          <p className="text-[11px] text-[#9A9A9A] mb-6">Kode error: {error.digest}</p>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="flex items-center gap-2 border border-[#E0E0E0] text-[#6B6B6B] px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:text-black transition-colors"
          >
            <RotateCcw size={14} />
            Coba Lagi
          </button>
          {/* <a> biasa (bukan <Link>) supaya navigasi full reload dan state yang error ikut bersih. */}
          <a
            href={homeHref}
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            {homeLabel}
          </a>
        </div>
      </div>
    </section>
  );
}