-- Absen via QR: opsi tambahan di samping absen foto (BUKAN pengganti).
-- Aditif dan forward-only: TIDAK ada UPDATE/backfill ke baris lama.
--   - work_locations.qr_enabled default false -> semua lokasi lama belum punya QR aktif,
--     perilaku absen tidak berubah sampai superadmin menyalakannya per lokasi.
--   - attendance.clock_in_metode / clock_out_metode NULL pada baris lama = absen foto.
-- JALANKAN SEBELUM deploy kode baru (API clock menulis kolom *_metode).

alter table public.work_locations
  add column if not exists qr_enabled boolean not null default false,
  -- Naik 1 setiap QR dibuat ulang; QR lama (versi lebih kecil) otomatis ditolak.
  add column if not exists qr_version integer not null default 1 check (qr_version >= 1);

alter table public.attendance
  add column if not exists clock_in_metode text
    check (clock_in_metode is null or clock_in_metode in ('foto', 'qr')),
  add column if not exists clock_out_metode text
    check (clock_out_metode is null or clock_out_metode in ('foto', 'qr'));

-- CATATAN RLS: qr_enabled/qr_version boleh terbaca karyawan (dipakai untuk menampilkan tombol
-- "Scan QR"); itu BUKAN rahasia. Yang menjadi rahasia adalah kunci tanda tangan di server
-- (ATTENDANCE_QR_SECRET, atau diturunkan dari SUPABASE_SERVICE_ROLE_KEY). Perubahan
-- qr_enabled/qr_version hanya lewat /api/attendance/qr/[lokasiId] (service role, superadmin).
