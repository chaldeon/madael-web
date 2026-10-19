// Pengambilan lowongan publik untuk halaman server /karir (daftar) dan
// /karir/[slug] (detail).
//
// getPublicJob dibungkus React cache() supaya generateMetadata, layout (JSON-LD),
// dan page yang memanggil fungsi ini dalam SATU request hanya memicu satu query
// ke Supabase (memoisasi per-request, tidak dibagi antar-request). Cache lintas
// request dilakukan di level halaman (ISR): `export const revalidate` di
// app/karir/page.js dan app/karir/[slug]/page.js, plus revalidatePath dari
// /api/job-listings/revalidate begitu lowongan disimpan.
//
// Hanya kolom publik: PUBLIC_JOB_COLUMNS + created_at (untuk datePosted).
// Jangan menambah salary_min/salary_max/show_salary/client_industry di sini.
// created_at sudah dibaca role anon oleh app/sitemap.js, tapi kalau GRANT kolom
// anon di database dibatasi per kolom, pastikan created_at ada di daftarnya.

import { cache } from 'react';
import { supabase } from '@/lib/supabase';
import { PUBLIC_JOB_COLUMNS } from '@/lib/jobListingOptions';
import { isPastDeadline } from '@/lib/jobStatus';

const JOB_DETAIL_COLUMNS = `${PUBLIC_JOB_COLUMNS}, created_at`;

// Kembalikan baris lowongan aktif dengan slug tsb, atau null kalau tidak ada /
// query gagal. Perilaku sama dengan generateMetadata sebelumnya: error tidak
// dilempar, hanya diperlakukan sebagai "tidak ditemukan".
export const getPublicJob = cache(async (slug) => {
  if (!slug) return null;

  const { data, error } = await supabase
    .from('job_listings')
    .select(JOB_DETAIL_COLUMNS)
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (error) {
    // PGRST116 = tidak ada baris (slug salah/nonaktif): kasus biasa, tidak
    // perlu di-log. Error lain (mis. izin kolom 42501) perlu terlihat.
    if (error.code !== 'PGRST116') console.error('Muat lowongan publik (server):', error);
    return null;
  }
  return data;
});

// Daftar lowongan aktif yang belum lewat deadline, terbaru dulu (kolom publik
// saja). Mengembalikan null kalau query gagal — bukan array kosong — supaya
// halaman bisa membedakan "belum ada lowongan" dari "gagal memuat" dan
// menyerahkan pemuatan ulang ke client.
export async function getPublicJobList() {
  const { data, error } = await supabase
    .from('job_listings')
    .select(PUBLIC_JOB_COLUMNS)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Muat daftar lowongan publik (server):', error);
    return null;
  }
  return (data || []).filter((job) => !isPastDeadline(job));
}
