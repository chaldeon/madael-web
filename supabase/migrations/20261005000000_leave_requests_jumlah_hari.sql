-- Alur cuti: simpan jumlah hari kerja yang DIPOTONG dari kuota saat approve.
-- Dipakai route /api/leave-requests/[id]/decision supaya pembatalan cuti yang
-- sudah disetujui mengembalikan kuota dengan angka yang sama persis, walaupun
-- jadwal kerja karyawan berubah setelah approve.
--
-- Nullable: baris lama (sudah approved sebelum migrasi ini) tetap NULL dan
-- dihitung ulang dari jadwal kerja saat pembatalan.
-- Jalankan SEBELUM men-deploy kode baru (approve akan menulis kolom ini).

alter table public.leave_requests
  add column if not exists jumlah_hari integer;

comment on column public.leave_requests.jumlah_hari is
  'Hari kerja yang dipotong dari kuota saat disetujui. NULL = belum disetujui / data lama.';
