-- Feedback / Pusat Bantuan — tiket + pesan, histori PERMANEN.
-- Jalankan sekali di Supabase SQL Editor. Aman dijalankan ulang (idempotent).
--
-- Prinsip yang ditegakkan di level DATABASE (bukan cuma di UI/API):
--   1. Tiket & pesan tidak pernah bisa dihapus (DELETE/TRUNCATE diblokir trigger).
--   2. Pesan tidak bisa diedit setelah terkirim (UPDATE diblokir trigger).
--   3. Data inti tiket (pemilik, jenis, modul, ringkasan) tidak bisa diubah;
--      hanya status + penanda balasan yang boleh berubah.
--   4. Nama pengirim/pembalas diambil dari employees.nama oleh trigger (tidak
--      bisa dipalsukan) lalu disimpan sebagai snapshot di baris pesan.
--   5. Pesan is_staff=true hanya boleh dari akun dengan flag 'support_access'.
--
-- Semua INSERT lewat API route (service role); tidak ada policy INSERT/UPDATE/
-- DELETE untuk anon/authenticated. Lampiran disimpan di bucket privat.

-- ---------- Tabel ----------
create table if not exists public.feedback_tickets (
  id              uuid primary key default gen_random_uuid(),
  ticket_no       bigint generated always as identity unique,
  employee_id     uuid not null references public.employees(id) on delete restrict,
  employee_nama   text not null,
  jenis           text not null check (jenis in ('bug', 'pertanyaan', 'saran')),
  modul           text not null,          -- key auto-tag, mis. 'absensi'
  modul_label     text not null,          -- label saat tiket dibuat, mis. 'Absensi'
  halaman         text,                   -- path halaman asal, mis. '/employee/absensi'
  ringkasan       text not null,          -- potongan awal pesan pertama (untuk list)
  status          text not null default 'baru' check (status in ('baru', 'diproses', 'selesai')),
  last_staff_nama text,                   -- pembalas terakhir (untuk 'Dijawab oleh')
  last_staff_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  closed_at       timestamptz
);

create table if not exists public.feedback_messages (
  id              uuid primary key default gen_random_uuid(),
  ticket_id       uuid not null references public.feedback_tickets(id) on delete restrict,
  author_id       uuid not null references public.employees(id) on delete restrict,
  author_nama     text not null,          -- snapshot nama asli, diisi trigger
  is_staff        boolean not null default false,
  isi             text not null check (char_length(btrim(isi)) between 1 and 4000),
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  created_at      timestamptz not null default now()
);

create index if not exists feedback_tickets_owner_idx  on public.feedback_tickets (employee_id, updated_at desc);
create index if not exists feedback_tickets_queue_idx  on public.feedback_tickets (status, modul, updated_at desc);
create index if not exists feedback_messages_thread_idx on public.feedback_messages (ticket_id, created_at);

-- ---------- Trigger: tidak ada hapus / edit ----------
create or replace function public.feedback_block_change() returns trigger
language plpgsql as $$
begin
  raise exception 'Tiket dan pesan feedback bersifat permanen: tidak bisa diedit atau dihapus.';
end $$;

drop trigger if exists feedback_messages_no_change on public.feedback_messages;
create trigger feedback_messages_no_change
  before update or delete on public.feedback_messages
  for each row execute function public.feedback_block_change();

drop trigger if exists feedback_messages_no_truncate on public.feedback_messages;
create trigger feedback_messages_no_truncate
  before truncate on public.feedback_messages
  for each statement execute function public.feedback_block_change();

drop trigger if exists feedback_tickets_no_delete on public.feedback_tickets;
create trigger feedback_tickets_no_delete
  before delete on public.feedback_tickets
  for each row execute function public.feedback_block_change();

drop trigger if exists feedback_tickets_no_truncate on public.feedback_tickets;
create trigger feedback_tickets_no_truncate
  before truncate on public.feedback_tickets
  for each statement execute function public.feedback_block_change();

-- ---------- Trigger: tiket cuma boleh ganti status/penanda balasan ----------
create or replace function public.feedback_tickets_guard_update() returns trigger
language plpgsql as $$
begin
  if row(NEW.id, NEW.ticket_no, NEW.employee_id, NEW.employee_nama, NEW.jenis, NEW.modul,
         NEW.modul_label, NEW.halaman, NEW.ringkasan, NEW.created_at)
     is distinct from
     row(OLD.id, OLD.ticket_no, OLD.employee_id, OLD.employee_nama, OLD.jenis, OLD.modul,
         OLD.modul_label, OLD.halaman, OLD.ringkasan, OLD.created_at) then
    raise exception 'Data inti tiket feedback tidak bisa diubah.';
  end if;

  if NEW.status is distinct from OLD.status then
    NEW.closed_at := case when NEW.status = 'selesai' then now() else null end;
  end if;
  NEW.updated_at := now();
  return NEW;
end $$;

drop trigger if exists feedback_tickets_guard on public.feedback_tickets;
create trigger feedback_tickets_guard
  before update on public.feedback_tickets
  for each row execute function public.feedback_tickets_guard_update();

-- ---------- Trigger: validasi + snapshot nama sebelum pesan masuk ----------
create or replace function public.feedback_messages_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_nama  text;
  v_owner uuid;
begin
  select nama into v_nama from public.employees where id = NEW.author_id;
  if v_nama is null then
    raise exception 'Pengirim pesan tidak ditemukan.';
  end if;
  NEW.author_nama := v_nama;

  if NEW.is_staff then
    if not exists (
      select 1 from public.employee_modules
      where employee_id = NEW.author_id and module_name = 'support_access'
    ) then
      raise exception 'Akun ini tidak punya Akses Support.';
    end if;
  else
    select employee_id into v_owner from public.feedback_tickets where id = NEW.ticket_id;
    if v_owner is distinct from NEW.author_id then
      raise exception 'Hanya pemilik tiket yang bisa mengirim pesan pengguna.';
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists feedback_messages_before_ins on public.feedback_messages;
create trigger feedback_messages_before_ins
  before insert on public.feedback_messages
  for each row execute function public.feedback_messages_before_insert();

-- ---------- Trigger: status otomatis setelah pesan masuk ----------
--  balasan staff ke tiket 'baru'          -> 'diproses' (+ catat pembalas)
--  pesan user ke tiket 'selesai'          -> 'baru' (dibuka lagi)
create or replace function public.feedback_messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.feedback_tickets t set
    status = case
      when NEW.is_staff and t.status = 'baru'        then 'diproses'
      when not NEW.is_staff and t.status = 'selesai' then 'baru'
      else t.status end,
    last_staff_nama = case when NEW.is_staff then NEW.author_nama else t.last_staff_nama end,
    last_staff_at   = case when NEW.is_staff then NEW.created_at  else t.last_staff_at end
  where t.id = NEW.ticket_id;
  return NEW;
end $$;

drop trigger if exists feedback_messages_after_ins on public.feedback_messages;
create trigger feedback_messages_after_ins
  after insert on public.feedback_messages
  for each row execute function public.feedback_messages_after_insert();

-- ---------- Buat tiket + pesan pertama dalam SATU transaksi ----------
-- (tiket tanpa pesan tidak boleh ada, dan tiket tidak bisa dihapus)
create or replace function public.feedback_create_ticket(
  p_employee_id uuid, p_jenis text, p_modul text, p_modul_label text, p_halaman text,
  p_isi text, p_att_path text, p_att_name text, p_att_mime text
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_nama text;
  v_id   uuid;
begin
  select nama into v_nama from public.employees where id = p_employee_id;
  if v_nama is null then
    raise exception 'Employee tidak ditemukan.';
  end if;

  insert into public.feedback_tickets
    (employee_id, employee_nama, jenis, modul, modul_label, halaman, ringkasan)
  values
    (p_employee_id, v_nama, p_jenis, p_modul, p_modul_label, p_halaman, left(btrim(p_isi), 140))
  returning id into v_id;

  insert into public.feedback_messages
    (ticket_id, author_id, author_nama, is_staff, isi, attachment_path, attachment_name, attachment_mime)
  values
    (v_id, p_employee_id, v_nama, false, p_isi, p_att_path, p_att_name, p_att_mime);

  return v_id;
end $$;

revoke all on function public.feedback_create_ticket(uuid, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.feedback_create_ticket(uuid, text, text, text, text, text, text, text, text)
  to service_role;

-- ---------- RLS: baca saja ----------
create or replace function public.feedback_current_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.employees
  where email = (auth.jwt() ->> 'email') and status = 'Aktif'
  limit 1
$$;

-- Flag 'support_access' selalu butuh baris eksplisit (superadmin tidak bypass).
create or replace function public.feedback_has_support_access() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employee_modules m
    where m.employee_id = public.feedback_current_employee_id()
      and m.module_name = 'support_access'
  )
$$;

alter table public.feedback_tickets  enable row level security;
alter table public.feedback_messages enable row level security;

revoke all on public.feedback_tickets, public.feedback_messages from anon, authenticated;
grant select on public.feedback_tickets, public.feedback_messages to authenticated;

drop policy if exists feedback_tickets_select on public.feedback_tickets;
create policy feedback_tickets_select on public.feedback_tickets
  for select to authenticated
  using (employee_id = public.feedback_current_employee_id() or public.feedback_has_support_access());

drop policy if exists feedback_messages_select on public.feedback_messages;
create policy feedback_messages_select on public.feedback_messages
  for select to authenticated
  using (exists (select 1 from public.feedback_tickets t where t.id = feedback_messages.ticket_id));

-- ---------- Bucket lampiran (privat; akses hanya lewat service role + signed URL) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-attachments', 'feedback-attachments', false, 4194304,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ---------- (Opsional) Simulasi balasan staff untuk tes tampilan 'Dijawab oleh' ----------
-- Ganti EMAIL_PEMEGANG_SUPPORT & TICKET_ID. Akun itu harus punya flag support_access.
-- insert into public.feedback_messages (ticket_id, author_id, author_nama, is_staff, isi)
-- select 'TICKET_ID'::uuid, id, nama, true, 'Halo, sudah kami cek ya.'
-- from public.employees where email = 'EMAIL_PEMEGANG_SUPPORT';
