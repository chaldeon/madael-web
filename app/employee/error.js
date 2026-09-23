'use client';

import RouteError from '@/components/RouteError';

export default function EmployeeError({ error, reset }) {
  return (
    <RouteError
      error={error}
      reset={reset}
      homeHref="/employee/dashboard"
      homeLabel="Kembali ke Dashboard"
      fullScreen
    />
  );
}