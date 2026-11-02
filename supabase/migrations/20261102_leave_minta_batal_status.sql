-- Minta batalkan cuti (versi penuh): simpan status permintaan di leave_requests.
--
-- Sebelumnya permintaan batal hanya berupa notifikasi ke HR, tanpa status di
-- database. Kolom di bawah menyimpan permintaan karyawan, jawaban HR, dan
-- hasilnya, supaya status tidak hilang saat halaman dimuat ulang.
--
--   minta_batal_status : NULL (tidak ada permintaan) | 'menunggu' | 'ditolak'
--                        | 'disetujui' (HR membatalkan cuti sebagai jawaban
--                        permintaan; status cuti itu sendiri jadi 'cancelled')
--   minta_batal_at     : waktu permintaan terakhir dikirim
--   minta_batal_alasan : alasan dari karyawan (opsional)
--   minta_batal_catatan: catatan HR saat menolak permintaan (opsional)
--
-- Idempotent: aman dijalankan ulang di Supabase SQL Editor. Tidak mengubah RLS
-- dan tidak mengisi data lama: kolom baru hanya diisi lewat route server
-- (service role) /api/leave-requests/[id]/request-cancel, .../reject-cancel,
-- dan .../decision. Tidak ada data yang dihapus atau diubah.

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS minta_batal_status text,
  ADD COLUMN IF NOT EXISTS minta_batal_at timestamptz,
  ADD COLUMN IF NOT EXISTS minta_batal_alasan text,
  ADD COLUMN IF NOT EXISTS minta_batal_catatan text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leave_requests_minta_batal_status_check'
      AND conrelid = 'public.leave_requests'::regclass
  ) THEN
    ALTER TABLE public.leave_requests
      ADD CONSTRAINT leave_requests_minta_batal_status_check
      CHECK (minta_batal_status IS NULL OR minta_batal_status IN ('menunggu', 'ditolak', 'disetujui'));
  END IF;
END $$;

-- Antrean HR: permintaan yang masih menunggu (filter "Permintaan batal",
-- badge dashboard, Inbox Persetujuan).
CREATE INDEX IF NOT EXISTS leave_requests_minta_batal_menunggu_idx
  ON public.leave_requests (minta_batal_at)
  WHERE minta_batal_status = 'menunggu';

NOTIFY pgrst, 'reload schema';
