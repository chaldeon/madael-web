-- =============================================================================
-- Riwayat revisi + pulihkan — modul Peraturan Ketenagakerjaan
-- File : sql/20261014_peraturan_revisi.sql
-- Jalankan di Supabase SQL Editor SEBELUM men-deploy kode yang memakainya.
-- Idempotent: aman dijalankan ulang (CREATE OR REPLACE / IF NOT EXISTS / DROP ... IF EXISTS).
--
-- Prasyarat: tabel peraturan, peraturan_relasi, peraturan_pasal, employees, dan
-- employee_modules sudah ada.
--
-- Isi:
--   1. helper: peraturan_revisi_akses(), peraturan_revisi_pelaku(), peraturan_revisi_bersih()
--   2. tabel peraturan_revisi (+ RLS: baca = pemegang flag; TIDAK ada policy tulis)
--   3. trigger pada peraturan (buat/ubah = AFTER, hapus = BEFORE)
--   4. backfill 1 revisi 'awal' untuk peraturan yang sudah ada
--   5. RPC pulihkan_peraturan_revisi(uuid) dan daftar_peraturan_terhapus()
--
-- Catatan desain:
--   * peraturan_revisi.peraturan_id TANPA foreign key, supaya riwayat bertahan
--     setelah peraturan dihapus.
--   * Penghapusan memakai trigger BEFORE DELETE: relasi dan pasal ikut di-cascade
--     oleh FK, jadi harus disalin ke revisi SEBELUM baris dihapus.
--   * Nomor versi aman dari balapan: update/hapus pada baris yang sama sudah
--     diserialkan oleh row lock, dan unique (peraturan_id, versi) jadi jaring pengaman.
--   * Trigger fail-closed: bila trigger error, update/hapus peraturan ikut gagal.
--     Itu disengaja (lebih baik gagal daripada hapus tanpa cadangan).
--   * Berkas PDF unggahan (pdf_drive_id, pdf_nama, pdf_ukuran) tercatat di snapshot
--     tetapi TIDAK dipulihkan: berkas di Drive sudah dihapus saat peraturan
--     dihapus atau PDF-nya diganti.
-- =============================================================================

begin;

-- 1. Helper -------------------------------------------------------------------

-- Hak akses modul. p_tulis = false: pemegang flag peraturan_ketenagakerjaan.
-- p_tulis = true: pemegang flag yang juga superadmin. SECURITY DEFINER supaya
-- membaca employees/employee_modules tidak terkena RLS (menghindari rekursi).
create or replace function public.peraturan_revisi_akses(p_tulis boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    join public.employee_modules m
      on m.employee_id = e.id
     and m.module_name = 'peraturan_ketenagakerjaan'
    where lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and e.status = 'Aktif'
      and (not p_tulis or coalesce(e.is_superadmin, false))
  );
$$;

-- id employees milik akun yang sedang login; NULL bila tanpa sesi (SQL Editor).
create or replace function public.peraturan_revisi_pelaku()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select e.id
  from public.employees e
  where lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

-- Buang kolom internal pencarian (search_*, *_tsv) dari jsonb baris. Dengan
-- p_tanpa_audit = true, updated_at/updated_by juga dibuang (untuk membandingkan isi).
create or replace function public.peraturan_revisi_bersih(p jsonb, p_tanpa_audit boolean default false)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(j.key, j.value), '{}'::jsonb)
  from jsonb_each(p) j
  where j.key !~ '(^search_|_tsv$|_tsvector$)'
    and not (p_tanpa_audit and j.key in ('updated_at', 'updated_by'));
$$;

-- 2. Tabel --------------------------------------------------------------------

create table if not exists public.peraturan_revisi (
  id               uuid primary key default gen_random_uuid(),
  peraturan_id     uuid not null,                       -- TANPA FK (riwayat bertahan setelah hapus)
  versi            int  not null check (versi >= 1),
  aksi             text not null check (aksi in ('awal', 'buat', 'ubah', 'hapus')),
  snapshot         jsonb not null,                      -- keadaan baris SETELAH aksi (untuk 'hapus': sebelum dihapus)
  relasi           jsonb,                               -- hanya 'hapus': relasi masuk + keluar
  pasal            jsonb,                               -- hanya 'hapus': seluruh pasal
  jumlah_relasi    int,
  jumlah_pasal     int,
  sumber_revisi_id uuid,                                -- bila revisi ini hasil pemulihan: revisi yang dipulihkan
  diubah_oleh      uuid,                                -- employees.id (tanpa FK); NULL = sistem / SQL Editor
  diubah_pada      timestamptz not null default now(),
  unique (peraturan_id, versi)
);

create index if not exists peraturan_revisi_hapus_idx
  on public.peraturan_revisi (diubah_pada desc)
  where aksi = 'hapus';

alter table public.peraturan_revisi enable row level security;

drop policy if exists peraturan_revisi_select on public.peraturan_revisi;
create policy peraturan_revisi_select on public.peraturan_revisi
  for select to authenticated
  using (public.peraturan_revisi_akses(false));

-- Sengaja TIDAK ada policy insert/update/delete: hanya trigger (SECURITY DEFINER)
-- yang menulis, dan riwayat tidak bisa diubah dari klien.
revoke all on public.peraturan_revisi from anon, authenticated;
grant select on public.peraturan_revisi to authenticated;

-- 3. Trigger ------------------------------------------------------------------

create or replace function public.peraturan_revisi_catat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_aksi   text;
  v_snap   jsonb;
  v_relasi jsonb;
  v_pasal  jsonb;
  v_jr     int;
  v_jp     int;
  v_versi  int;
  v_sumber uuid;
begin
  if tg_op = 'DELETE' then
    v_id := old.id;
  else
    v_id := new.id;
  end if;

  if tg_op = 'UPDATE' then
    -- Lewati bila hanya updated_at/updated_by/kolom pencarian yang berubah.
    if public.peraturan_revisi_bersih(to_jsonb(old), true) = public.peraturan_revisi_bersih(to_jsonb(new), true) then
      return new;
    end if;
    v_aksi := 'ubah';
    v_snap := public.peraturan_revisi_bersih(to_jsonb(new));
  elsif tg_op = 'INSERT' then
    v_aksi := 'buat';
    v_snap := public.peraturan_revisi_bersih(to_jsonb(new));
  else
    v_aksi := 'hapus';
    v_snap := public.peraturan_revisi_bersih(to_jsonb(old));

    select coalesce(jsonb_agg(jsonb_build_object(
             'peraturan_id', r.peraturan_id,
             'terkait_id',   r.terkait_id,
             'jenis_relasi', r.jenis_relasi,
             'catatan',      r.catatan)), '[]'::jsonb),
           count(*)
      into v_relasi, v_jr
      from public.peraturan_relasi r
     where r.peraturan_id = old.id or r.terkait_id = old.id;

    select coalesce(jsonb_agg(public.peraturan_revisi_bersih(to_jsonb(s)) order by s.urutan), '[]'::jsonb),
           count(*)
      into v_pasal, v_jp
      from public.peraturan_pasal s
     where s.peraturan_id = old.id;
  end if;

  select coalesce(max(r.versi), 0) + 1 into v_versi
    from public.peraturan_revisi r
   where r.peraturan_id = v_id;

  -- Diisi oleh pulihkan_peraturan_revisi() lewat set_config (lokal transaksi).
  v_sumber := nullif(current_setting('peraturan.sumber_revisi', true), '')::uuid;

  insert into public.peraturan_revisi
    (peraturan_id, versi, aksi, snapshot, relasi, pasal, jumlah_relasi, jumlah_pasal,
     sumber_revisi_id, diubah_oleh)
  values
    (v_id, v_versi, v_aksi, v_snap, v_relasi, v_pasal, v_jr, v_jp,
     v_sumber, public.peraturan_revisi_pelaku());

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.peraturan_revisi_catat() from public;

drop trigger if exists peraturan_revisi_catat_ubah on public.peraturan;
create trigger peraturan_revisi_catat_ubah
  after insert or update on public.peraturan
  for each row execute function public.peraturan_revisi_catat();

drop trigger if exists peraturan_revisi_catat_hapus on public.peraturan;
create trigger peraturan_revisi_catat_hapus
  before delete on public.peraturan
  for each row execute function public.peraturan_revisi_catat();

-- 4. Backfill -----------------------------------------------------------------
-- Satu revisi 'awal' untuk peraturan yang belum punya riwayat. Pelaku NULL:
-- siapa pembuat/pengubah asli ada di snapshot (created_by, updated_by).

insert into public.peraturan_revisi (peraturan_id, versi, aksi, snapshot)
select p.id, 1, 'awal', public.peraturan_revisi_bersih(to_jsonb(p))
from public.peraturan p
where not exists (select 1 from public.peraturan_revisi r where r.peraturan_id = p.id);

-- 5. RPC ----------------------------------------------------------------------

-- Memulihkan satu revisi. Hanya superadmin pemegang flag (dicek DI DALAM fungsi).
--   * revisi 'hapus'            : peraturan dibuat ulang (id sama) beserta relasi & pasal.
--   * revisi 'awal'/'buat'/'ubah': isi peraturan yang ada dikembalikan ke snapshot.
-- Pemulihan selalu menambah revisi baru; riwayat lama tidak ditimpa.
-- Error yang boleh tampil ke pengguna memakai SQLSTATE 'PR001' (pesan Indonesia).
create or replace function public.pulihkan_peraturan_revisi(p_revisi_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_isi constant text[] := array[
    'jenis', 'nomor', 'tahun', 'judul', 'tentang', 'tanggal_ditetapkan', 'tanggal_berlaku',
    'status', 'ringkasan', 'url_sumber', 'url_pdf', 'topik', 'keywords'
  ];
  v_rev    public.peraturan_revisi%rowtype;
  v_rec    public.peraturan%rowtype;
  v_ada    boolean;
  v_pelaku uuid;
  v_sama   boolean;
  v_dil    int := 0;
  v_lewat  int := 0;
  v_pasal  int := 0;
  v_baru   int;
begin
  if not public.peraturan_revisi_akses(true) then
    raise exception 'Kamu tidak punya izin memulihkan peraturan.' using errcode = '42501';
  end if;

  select * into v_rev from public.peraturan_revisi where id = p_revisi_id;
  if not found then
    raise exception 'Revisi tidak ditemukan.' using errcode = 'PR001';
  end if;

  select exists (select 1 from public.peraturan p where p.id = v_rev.peraturan_id) into v_ada;
  select * into v_rec from jsonb_populate_record(null::public.peraturan, v_rev.snapshot);
  v_pelaku := public.peraturan_revisi_pelaku();

  perform set_config('peraturan.sumber_revisi', p_revisi_id::text, true);

  if v_rev.aksi = 'hapus' then
    if v_ada then
      raise exception 'Peraturan ini sudah ada kembali (mungkin sudah dipulihkan). Muat ulang halaman.' using errcode = 'PR001';
    end if;

    begin
      insert into public.peraturan
        (id, jenis, nomor, tahun, judul, tentang, tanggal_ditetapkan, tanggal_berlaku, status,
         ringkasan, url_sumber, url_pdf, topik, keywords, created_by, created_at)
      values
        (v_rec.id, v_rec.jenis, v_rec.nomor, v_rec.tahun, v_rec.judul, v_rec.tentang,
         v_rec.tanggal_ditetapkan, v_rec.tanggal_berlaku, v_rec.status, v_rec.ringkasan,
         v_rec.url_sumber, v_rec.url_pdf, v_rec.topik, v_rec.keywords,
         case when exists (select 1 from public.employees e where e.id = v_rec.created_by)
              then v_rec.created_by else v_pelaku end,
         coalesce(v_rec.created_at, now()));
    exception when unique_violation then
      raise exception 'Tidak bisa dipulihkan: sudah ada peraturan lain dengan jenis, nomor, dan tahun yang sama.' using errcode = 'PR001';
    end;

    -- Relasi: hanya yang kedua ujungnya masih ada.
    insert into public.peraturan_relasi (peraturan_id, terkait_id, jenis_relasi, catatan)
    select r.peraturan_id, r.terkait_id, r.jenis_relasi, r.catatan
    from jsonb_populate_recordset(null::public.peraturan_relasi, coalesce(v_rev.relasi, '[]'::jsonb)) r
    where exists (select 1 from public.peraturan p where p.id = r.peraturan_id)
      and exists (select 1 from public.peraturan p where p.id = r.terkait_id)
    on conflict do nothing;
    get diagnostics v_dil = row_count;
    v_lewat := greatest(coalesce(v_rev.jumlah_relasi, 0) - v_dil, 0);

    insert into public.peraturan_pasal
      (id, peraturan_id, nomor_pasal, urutan, judul, isi, catatan, created_at, updated_at)
    select s.id, s.peraturan_id, s.nomor_pasal, s.urutan, s.judul, s.isi, s.catatan,
           coalesce(s.created_at, now()), coalesce(s.updated_at, now())
    from jsonb_populate_recordset(null::public.peraturan_pasal, coalesce(v_rev.pasal, '[]'::jsonb)) s
    on conflict do nothing;
    get diagnostics v_pasal = row_count;
  else
    if not v_ada then
      raise exception 'Peraturan ini sudah dihapus. Pulihkan dari halaman Terhapus.' using errcode = 'PR001';
    end if;

    select (
             (select jsonb_object_agg(j.key, j.value) from jsonb_each(v_rev.snapshot) j where j.key = any (c_isi))
             is not distinct from
             (select jsonb_object_agg(j.key, j.value) from jsonb_each(to_jsonb(p)) j where j.key = any (c_isi))
           )
      into v_sama
      from public.peraturan p
     where p.id = v_rev.peraturan_id;
    if v_sama then
      raise exception 'Isi peraturan sudah sama dengan versi ini; tidak ada yang dipulihkan.' using errcode = 'PR001';
    end if;

    begin
      update public.peraturan
         set jenis = v_rec.jenis, nomor = v_rec.nomor, tahun = v_rec.tahun, judul = v_rec.judul,
             tentang = v_rec.tentang, tanggal_ditetapkan = v_rec.tanggal_ditetapkan,
             tanggal_berlaku = v_rec.tanggal_berlaku, status = v_rec.status,
             ringkasan = v_rec.ringkasan, url_sumber = v_rec.url_sumber, url_pdf = v_rec.url_pdf,
             topik = v_rec.topik, keywords = v_rec.keywords
       where id = v_rev.peraturan_id;
    exception when unique_violation then
      raise exception 'Tidak bisa dipulihkan: jenis, nomor, dan tahun pada versi ini sudah dipakai peraturan lain.' using errcode = 'PR001';
    end;
  end if;

  select max(r.versi) into v_baru from public.peraturan_revisi r where r.peraturan_id = v_rev.peraturan_id;
  perform set_config('peraturan.sumber_revisi', '', true);

  return jsonb_build_object(
    'peraturan_id',      v_rev.peraturan_id,
    'versi_sumber',      v_rev.versi,
    'aksi_sumber',       v_rev.aksi,
    'versi_baru',        v_baru,
    'relasi_dipulihkan', v_dil,
    'relasi_dilewati',   v_lewat,
    'pasal_dipulihkan',  v_pasal
  );
end;
$$;

revoke all on function public.pulihkan_peraturan_revisi(uuid) from public, anon;
grant execute on function public.pulihkan_peraturan_revisi(uuid) to authenticated;

-- Peraturan yang SAAT INI terhapus (revisi terakhirnya = 'hapus'). SECURITY INVOKER:
-- RLS peraturan_revisi yang berlaku (pemegang flag). Tanpa kolom jsonb besar.
create or replace function public.daftar_peraturan_terhapus()
returns table (
  revisi_id     uuid,
  peraturan_id  uuid,
  versi         int,
  jenis         text,
  nomor         text,
  tahun         int,
  judul         text,
  status        text,
  jumlah_relasi int,
  jumlah_pasal  int,
  dihapus_oleh  uuid,
  dihapus_pada  timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select r.id, r.peraturan_id, r.versi,
         r.snapshot ->> 'jenis', r.snapshot ->> 'nomor', (r.snapshot ->> 'tahun')::int,
         r.snapshot ->> 'judul', r.snapshot ->> 'status',
         coalesce(r.jumlah_relasi, 0), coalesce(r.jumlah_pasal, 0),
         r.diubah_oleh, r.diubah_pada
  from public.peraturan_revisi r
  where r.aksi = 'hapus'
    and r.versi = (select max(x.versi) from public.peraturan_revisi x where x.peraturan_id = r.peraturan_id)
    and not exists (select 1 from public.peraturan p where p.id = r.peraturan_id)
  order by r.diubah_pada desc
  limit 200;
$$;

revoke all on function public.daftar_peraturan_terhapus() from public, anon;
grant execute on function public.daftar_peraturan_terhapus() to authenticated;

commit;
