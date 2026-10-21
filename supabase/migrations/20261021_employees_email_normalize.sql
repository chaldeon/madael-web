-- Normalisasi email karyawan (employees.email)
--
-- Latar belakang:
--   Supabase Auth menyimpan email dalam huruf kecil, sedangkan lookup di
--   aplikasi memakai `.eq('email', user.email)` (perbandingan persis). Email
--   yang tersimpan dengan huruf besar/spasi di tabel employees membuat login
--   menampilkan "Akun ini belum terdaftar".
--
-- Isi migrasi (idempotent, aman dijalankan berulang):
--   1. Cek duplikat email yang hanya beda huruf besar/kecil/spasi. Kalau ada,
--      migrasi BERHENTI dengan daftar duplikatnya (rapikan manual dulu).
--   2. Rapikan data lama: email = lower(btrim(email)).
--   3. Unique index pada lower(email).
--   4. Trigger pengaman: email selalu di-trim + lowercase saat INSERT/UPDATE,
--      termasuk kalau baris diubah langsung lewat Supabase Dashboard / SQL.
--
-- Cara menjalankan: Supabase Dashboard > SQL Editor > tempel seluruh isi file
-- ini > Run. Tidak perlu RLS baru (tidak ada tabel baru).

-- 1. Pre-check duplikat -----------------------------------------------------
DO $$
DECLARE
  dup_list text;
BEGIN
  SELECT string_agg(format('%s (%s baris)', em, cnt), ', ')
    INTO dup_list
  FROM (
    SELECT lower(btrim(email)) AS em, count(*) AS cnt
    FROM public.employees
    WHERE email IS NOT NULL
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
  ) d;

  IF dup_list IS NOT NULL THEN
    RAISE EXCEPTION
      'Ada email duplikat (beda huruf besar/kecil/spasi): %. Gabungkan atau hapus salah satunya dulu, lalu jalankan ulang migrasi ini.',
      dup_list;
  END IF;
END $$;

-- 2. Rapikan data lama ------------------------------------------------------
UPDATE public.employees
SET email = lower(btrim(email))
WHERE email IS NOT NULL
  AND email IS DISTINCT FROM lower(btrim(email));

-- 3. Unique index lower(email) ----------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS employees_email_lower_key
  ON public.employees (lower(email));

-- 4. Trigger normalisasi ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.employees_normalize_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NOT NULL THEN
    NEW.email := lower(btrim(NEW.email));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS employees_normalize_email_trg ON public.employees;
CREATE TRIGGER employees_normalize_email_trg
  BEFORE INSERT OR UPDATE OF email ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.employees_normalize_email();
