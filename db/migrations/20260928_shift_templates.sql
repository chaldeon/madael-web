-- Template Shift (nama + jam masuk/pulang + toleransi + hari kerja) yang bisa di-assign
-- ke karyawan lewat halaman Semua Karyawan > Jadwal Kerja.
--
-- Aditif dan forward-only:
--   - work_schedule tetap menjadi jadwal efektif per karyawan yang dibaca semua modul
--     (absensi, payroll, cuti, rekap). Tidak ada pembaca lama yang perlu diubah.
--   - work_schedule.shift_template_id hanya menandai "jadwal ini berasal dari template X".
--     NULL = jadwal kustom (semua baris lama otomatis NULL, perilaku tidak berubah).
--   - Baris attendance lama tidak disentuh.
-- JALANKAN SEBELUM deploy kode baru.

create table if not exists public.shift_templates (
  id uuid primary key default gen_random_uuid(),
  nama text not null check (char_length(btrim(nama)) between 1 and 60),
  jam_masuk time not null,
  jam_pulang time not null,
  toleransi_menit smallint not null default 0 check (toleransi_menit between 0 and 120),
  hari_kerja text[] not null default array['Senin','Selasa','Rabu','Kamis','Jumat'],
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  -- v1: shift dalam satu hari kalender. Shift lintas tengah malam belum didukung
  -- karena absensi dikunci per tanggal (attendance unique employee_id + tanggal).
  constraint shift_templates_jam_check check (jam_pulang > jam_masuk)
);

create unique index if not exists shift_templates_nama_uniq
  on public.shift_templates (lower(btrim(nama)));

-- on delete set null: kalau template terhapus, jadwal karyawan tetap utuh (jadi kustom).
alter table public.work_schedule
  add column if not exists shift_template_id uuid
    references public.shift_templates(id) on delete set null;

create index if not exists work_schedule_shift_template_idx
  on public.work_schedule (shift_template_id);

-- RLS: semua karyawan login boleh membaca (dropdown), hanya superadmin yang boleh menulis.
-- ASUMSI: employees.email = email login dan employees.is_superadmin ada (sama dengan
-- yang dipakai useModuleAccess). Samakan dengan policy work_schedule kalau berbeda.
alter table public.shift_templates enable row level security;

drop policy if exists shift_templates_select on public.shift_templates;
create policy shift_templates_select on public.shift_templates
  for select to authenticated using (true);

drop policy if exists shift_templates_write on public.shift_templates;
create policy shift_templates_write on public.shift_templates
  for all to authenticated
  using (exists (
    select 1 from public.employees e
    where e.email = (auth.jwt() ->> 'email') and e.is_superadmin = true
  ))
  with check (exists (
    select 1 from public.employees e
    where e.email = (auth.jwt() ->> 'email') and e.is_superadmin = true
  ));
