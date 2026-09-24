-- Toleransi keterlambatan + alasan karyawan + justify HR.
-- Aditif dan forward-only: TIDAK ada UPDATE/backfill ke baris lama.
--   - Baris work_schedule lama otomatis toleransi_menit = 0 (perilaku sama seperti sebelumnya).
--   - Baris attendance lama: alasan_telat/justified = NULL, status_telat tidak disentuh.
-- JALANKAN SEBELUM deploy kode baru (API clock membaca kolom toleransi_menit).

alter table public.work_schedule
  add column if not exists toleransi_menit smallint not null default 0
    check (toleransi_menit between 0 and 120);

alter table public.attendance
  add column if not exists alasan_telat text
    check (alasan_telat is null or char_length(alasan_telat) <= 300),
  add column if not exists alasan_telat_at timestamptz,
  -- Snapshot toleransi yang berlaku saat clock-in. NULL = baris lama (sebelum fitur ini),
  -- dipakai payroll untuk membedakan: baris lama dihitung persis seperti dulu.
  add column if not exists toleransi_menit smallint,
  -- NULL = belum ditinjau HR, true = Justified, false = tidak disetujui
  add column if not exists justified boolean,
  add column if not exists justified_at timestamptz;

-- justified_by mengikuti tipe employees.id (uuid/bigint), jadi tidak perlu ditebak.
do $$
declare t text;
begin
  select format_type(a.atttypid, a.atttypmod) into t
  from pg_attribute a
  where a.attrelid = 'public.employees'::regclass and a.attname = 'id';

  execute format(
    'alter table public.attendance add column if not exists justified_by %s references public.employees(id) on delete set null',
    t
  );
end $$;

-- CATATAN RLS: kolom alasan_telat*/justified* hanya boleh ditulis lewat API server
-- (service role): /api/attendance/late-reason dan /api/attendance/justify.
-- Pastikan karyawan biasa TIDAK punya policy UPDATE di tabel attendance.
