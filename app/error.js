'use client';

import RouteError from '@/components/RouteError';

export default function Error({ error, reset }) {
  return <RouteError error={error} reset={reset} homeHref="/" homeLabel="Kembali ke Beranda" />;
}