-- Lanjutan Feedback / Pusat Bantuan (jalankan SETELAH 20260929_feedback_tickets.sql).
-- Aman dijalankan ulang (idempotent). Jalankan SQL ini SEBELUM deploy kode barunya.
--
-- Isi:
--   1. Pencatat penutup tiket (closed_by + snapshot nama, diisi trigger dari
--      employees.nama sehingga tidak bisa dipalsukan).
--   2. Penanda baca user (user_last_read_at) + kolom turunan user_unread untuk
--      badge di bubble & titik "belum dibaca" di daftar tiket.
--   3. Aturan penutupan: pemilik tiket hanya boleh menandai selesai SETELAH tim
--      support menjawab; tim support (flag support_access) boleh kapan saja.
--   4. updated_at tidak lagi di-bump otomatis oleh trigger untuk SEMUA update
--      (membuka tiket = menandai baca, tidak boleh mengubah urutan antrean).
--      Sekarang di-set eksplisit oleh pesan baru dan perubahan status.

-- ---------- Kolom baru ----------
alter table public.feedback_tickets
  add column if not exists closed_by         uuid references public.employees(id) on delete restrict,
  add column if not exists closed_by_nama    text,
  add column if not exists user_last_read_at timestamptz;

alter table public.feedback_tickets
  add column if not exists user_unread boolean generated always as (
    last_staff_at is not null and (user_last_read_at is null or last_staff_at > user_last_read_at)
  ) stored;

create index if not exists feedback_tickets_unread_idx
  on public.feedback_tickets (employee_id) where user_unread;

-- ---------- Guard update tiket (versi baru) ----------
create or replace function public.feedback_tickets_guard_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_staff boolean;
begin
  if row(NEW.id, NEW.ticket_no, NEW.employee_id, NEW.employee_nama, NEW.jenis, NEW.modul,
         NEW.modul_label, NEW.halaman, NEW.ringkasan, NEW.created_at)
     is distinct from
     row(OLD.id, OLD.ticket_no, OLD.employee_id, OLD.employee_nama, OLD.jenis, OLD.modul,
         OLD.modul_label, OLD.halaman, OLD.ringkasan, OLD.created_at) then
    raise exception 'Data inti tiket feedback tidak bisa diubah.';
  end if;

  if NEW.status is distinct from OLD.status then
    NEW.updated_at := now();

    if NEW.status = 'selesai' then
      if NEW.closed_by is not null then
        select nama into NEW.closed_by_nama from public.employees where id = NEW.closed_by;
        if NEW.closed_by_nama is null then
          raise exception 'Penutup tiket tidak ditemukan.';
        end if;

        v_staff := exists (
          select 1 from public.employee_modules
          where employee_id = NEW.closed_by and module_name = 'support_access'
        );
        if not v_staff then
          if NEW.closed_by is distinct from OLD.employee_id then
            raise exception 'Hanya pemilik tiket atau tim support yang bisa menutup tiket.';
          end if;
          if OLD.last_staff_at is null then
            raise exception 'Tiket baru bisa ditandai selesai setelah dijawab tim support.';
          end if;
        end if;
      else
        NEW.closed_by_nama := null;  -- kompatibilitas: penutup tidak diketahui
      end if;
      NEW.closed_at := now();
    else
      NEW.closed_at := null;
      NEW.closed_by := null;
      NEW.closed_by_nama := null;
    end if;
  elsif row(NEW.closed_at, NEW.closed_by, NEW.closed_by_nama)
        is distinct from row(OLD.closed_at, OLD.closed_by, OLD.closed_by_nama) then
    raise exception 'Penutup tiket tidak bisa diubah langsung.';
  end if;

  return NEW;
end $$;

-- ---------- Trigger setelah pesan masuk (versi baru: updated_at eksplisit) ----------
create or replace function public.feedback_messages_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.feedback_tickets t set
    status = case
      when NEW.is_staff and t.status = 'baru'        then 'diproses'
      when not NEW.is_staff and t.status = 'selesai' then 'baru'
      else t.status end,
    last_staff_nama = case when NEW.is_staff then NEW.author_nama else t.last_staff_nama end,
    last_staff_at   = case when NEW.is_staff then NEW.created_at  else t.last_staff_at end,
    updated_at      = NEW.created_at
  where t.id = NEW.ticket_id;
  return NEW;
end $$;

-- ---------- Backfill: balasan lama dianggap sudah dibaca (badge mulai dari 0) ----------
update public.feedback_tickets
set user_last_read_at = last_staff_at
where user_last_read_at is null and last_staff_at is not null;
