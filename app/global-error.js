'use client';

import './globals.css';
import RouteError from '@/components/RouteError';

// Penangkap error terakhir: dipakai kalau root layout sendiri yang error
// (app/error.js tidak bisa menangkap itu). Wajib membawa <html>/<body> sendiri
// karena menggantikan root layout.
export default function GlobalError({ error, reset }) {
  return (
    <html lang="id">
      <body>
        <RouteError error={error} reset={reset} homeHref="/" homeLabel="Kembali ke Beranda" fullScreen />
      </body>
    </html>
  );
}