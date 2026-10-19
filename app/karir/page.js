import KarirListClient from '@/components/karir/KarirListClient';
import { getPublicJobList } from '@/lib/publicJob';

// ISR: halaman dibangun di server lalu di-cache, jadi HTML awal sudah memuat
// daftar lowongan (SEO + cepat di ponsel) dan Supabase tidak ditembak di setiap
// kunjungan. Disegarkan otomatis tiap 5 menit, dan langsung saat lowongan
// disimpan lewat revalidatePath di /api/job-listings/revalidate.
export const revalidate = 300;

// Server component: mengambil daftar di server lalu menyerahkannya ke komponen
// client (filter, panel detail, bahasa). Kalau query gagal, initialJobs = null
// dan client memuat sendiri seperti sebelumnya.
export default async function KarirPage() {
  const initialJobs = await getPublicJobList();
  return <KarirListClient initialJobs={initialJobs} />;
}
