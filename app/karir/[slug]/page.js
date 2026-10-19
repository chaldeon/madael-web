import JobDetailClient from '@/components/karir/JobDetailClient';
import { getPublicJob } from '@/lib/publicJob';
import { isPastDeadline } from '@/lib/jobStatus';

// ISR: hasil render di-cache per slug dan disegarkan tiap 5 menit, atau langsung
// lewat revalidatePath saat lowongan disimpan (/api/job-listings/revalidate).
// generateStaticParams kosong membuat slug dirender saat pertama diminta lalu
// di-cache, tanpa butuh query Supabase saat build.
export const revalidate = 300;

export async function generateStaticParams() {
  return [];
}

// Server component: mengambil lowongan di server (fungsi ber-cache yang sama
// dengan layout/generateMetadata) lalu menyerahkannya ke komponen client, supaya
// konten lowongan sudah ada di HTML awal, bukan baru muncul setelah JS jalan.
export default async function KarirDetailPage({ params }) {
  const { slug } = await params;
  const job = await getPublicJob(slug);

  // Lowongan yang lewat deadline sengaja TIDAK diserahkan: halaman hanya
  // menampilkan pemberitahuan "ditutup", jadi deskripsi/pertanyaannya tidak
  // perlu ikut terkirim di HTML. Client tetap menjalankan alur lamanya.
  const initialJob = job && !isPastDeadline(job) ? job : null;

  return <JobDetailClient initialJob={initialJob} />;
}
