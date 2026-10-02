-- Talent Pool: tag manual untuk kandidat lamaran umum (applications.job_id IS NULL).
-- Jalankan sekali di Supabase SQL Editor SEBELUM fitur tag dipakai.
-- Aman dijalankan ulang (IF NOT EXISTS).

alter table public.applications
  add column if not exists tags text[] not null default '{}';

comment on column public.applications.tags is
  'Tag manual dari HR untuk kandidat talent pool (lowercase, maks 10 per kandidat).';
