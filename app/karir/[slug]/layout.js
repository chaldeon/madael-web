import { supabase } from '@/lib/supabase';

export async function generateMetadata({ params }) {
  const { slug } = await params;

  const { data: job } = await supabase
    .from('job_listings')
    .select('title, department, location')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (!job) {
    return {
      title: "Lowongan Tidak Ditemukan",
      description: "Lowongan yang Anda cari tidak ditemukan atau sudah tidak aktif.",
    };
  }

  const desc = `Lowongan ${job.title}${job.department ? ` — ${job.department}` : ''}${job.location ? `, ${job.location}` : ''}. Lamar sekarang di Madael Consult.`;

  return {
    title: job.title,
    description: desc,
    openGraph: {
      title: `${job.title} | Karir Madael Consult`,
      description: desc,
      url: `/karir/${slug}`,
    },
  };
}

export default function KarirDetailLayout({ children }) {
  return children;
}