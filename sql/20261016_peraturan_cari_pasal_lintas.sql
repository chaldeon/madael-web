-- Pencarian lintas-pasal untuk halaman daftar Peraturan Ketenagakerjaan.
--
-- RPC BARU, additif: cari_pasal dan cari_peraturan TIDAK diubah.
-- Dipanggil dari app/employee/peraturan/page.js bersama filter yang sama dengan
-- cari_peraturan, lalu hasilnya ditampilkan per peraturan dengan tautan
-- /employee/peraturan/<id>#pasal-<nomor>.
--
-- Cara kerja:
--   * Kata kunci dipecah per spasi (maks. 6 kata); SEMUA kata harus muncul di
--     nomor pasal / judul pasal / isi pasal, tanpa membedakan huruf besar/kecil.
--   * Memakai ILIKE (bukan tsvector) supaya tidak bergantung pada konfigurasi
--     full-text search kolom search_tsv. Aman untuk ukuran tabel pasal saat ini.
--   * `cuplikan` memakai penanda \u0002 ... \u0003 di sekitar kata yang cocok,
--     format yang sama dengan Cuplikan di components/peraturan/PeraturanParts.js.
--   * SECURITY INVOKER: RLS tabel peraturan & peraturan_pasal tetap berlaku,
--     jadi hanya akun pemegang akses modul yang mendapat hasil.
--
-- ASUMSI YANG PERLU DICEK terhadap cari_peraturan (definisinya tidak ada di repo):
--   * p_keywords: semua keyword harus ada (AND, operator @>). Kalau cari_peraturan
--     memakai "salah satu" (OR), ganti `@>` di bawah dengan `&&`.
--   * p_topik: peraturan.topik adalah array text.
--
-- Aman dijalankan ulang (create or replace).

create or replace function public.cari_pasal_lintas(
  p_q        text,
  p_jenis    text    default null,
  p_tahun    integer default null,
  p_status   text    default null,
  p_topik    text    default null,
  p_keywords text[]  default null,
  p_limit    integer default 100
)
returns table (
  pasal_id        peraturan_pasal.id%type,
  peraturan_id    peraturan.id%type,
  jenis           peraturan.jenis%type,
  nomor           peraturan.nomor%type,
  tahun           peraturan.tahun%type,
  judul_peraturan peraturan.judul%type,
  status          peraturan.status%type,
  nomor_pasal     peraturan_pasal.nomor_pasal%type,
  urutan          peraturan_pasal.urutan%type,
  judul_pasal     peraturan_pasal.judul%type,
  cuplikan        text,
  skor            integer,
  total_cocok     bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_q     text := btrim(regexp_replace(left(coalesce(p_q, ''), 200), '\s+', ' ', 'g'));
  v_terms text[];
  v_pola  text[];
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if length(v_q) < 2 then
    return;
  end if;

  select array_agg(s.t order by s.n)
    into v_terms
  from (
    select u.t, u.n
    from unnest(string_to_array(lower(v_q), ' ')) with ordinality as u(t, n)
    where u.t <> ''
    order by u.n
    limit 6
  ) s;

  if v_terms is null then
    return;
  end if;

  -- Escape karakter khusus LIKE (\ % _) agar kata kunci dicocokkan apa adanya.
  select array_agg('%' || regexp_replace(t, '([\\%_])', '\\\1', 'g') || '%' order by n)
    into v_pola
  from unnest(v_terms) with ordinality as x(t, n);

  return query
  with kandidat as (
    select
      pp.id            as k_pasal_id,
      pp.peraturan_id  as k_per_id,
      per.jenis        as k_jenis,
      per.nomor        as k_nomor,
      per.tahun        as k_tahun,
      per.judul        as k_judul_per,
      per.status       as k_status,
      pp.nomor_pasal   as k_nomor_pasal,
      pp.urutan        as k_urutan,
      pp.judul         as k_judul_pasal,
      regexp_replace(
        translate(coalesce(pp.isi, ''), chr(2) || chr(3), ''),
        '\s+', ' ', 'g'
      )                as k_isi
    from peraturan_pasal pp
    join peraturan per on per.id = pp.peraturan_id
    where (p_jenis    is null or per.jenis  = p_jenis)
      and (p_tahun    is null or per.tahun  = p_tahun)
      and (p_status   is null or per.status = p_status)
      and (p_topik    is null or p_topik = any (per.topik))
      and (p_keywords is null or per.keywords @> p_keywords)
      and (
        coalesce(pp.nomor_pasal, '') || ' ' ||
        coalesce(pp.judul, '')       || ' ' ||
        coalesce(pp.isi, '')
      ) ilike all (v_pola)
  ),
  bernilai as (
    select
      k.*,
      m.term as m_term,
      m.pos  as m_pos,
      1
        + case when lower(k.k_nomor_pasal) = any (v_terms) then 3 else 0 end
        + case when lower(coalesce(k.k_judul_pasal, '')) ilike all (v_pola) then 2 else 0 end
        + case when strpos(lower(k.k_isi), lower(v_q)) > 0 then 1 else 0 end
        as k_skor
    from kandidat k
    left join lateral (
      select t.term, strpos(lower(k.k_isi), t.term) as pos
      from unnest(v_terms) as t(term)
      where strpos(lower(k.k_isi), t.term) > 0
      order by pos
      limit 1
    ) m on true
  )
  select
    b.k_pasal_id,
    b.k_per_id,
    b.k_jenis,
    b.k_nomor,
    b.k_tahun,
    b.k_judul_per,
    b.k_status,
    b.k_nomor_pasal,
    b.k_urutan,
    b.k_judul_pasal,
    case
      when b.m_pos is null then left(b.k_isi, 200)
      else
        case when b.m_pos > 80 then '…' else '' end
        || substr(b.k_isi, greatest(b.m_pos - 80, 1), b.m_pos - greatest(b.m_pos - 80, 1))
        || chr(2) || substr(b.k_isi, b.m_pos, length(b.m_term)) || chr(3)
        || substr(b.k_isi, b.m_pos + length(b.m_term), 160)
        || case when b.m_pos + length(b.m_term) + 160 <= length(b.k_isi) then '…' else '' end
    end,
    b.k_skor::integer,
    count(*) over ()
  from bernilai b
  order by b.k_skor desc, b.k_tahun desc, b.k_per_id, b.k_urutan, b.k_pasal_id
  limit v_limit;
end;
$$;

revoke all on function public.cari_pasal_lintas(text, text, integer, text, text, text[], integer) from public, anon;
grant execute on function public.cari_pasal_lintas(text, text, integer, text, text, text[], integer) to authenticated;
