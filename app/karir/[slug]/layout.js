import { isPastDeadline } from '@/lib/jobStatus';
import { getPublicJob } from '@/lib/publicJob';
import { buildJobPostingJsonLd, serializeJsonLd } from '@/lib/jobPostingJsonLd';

export async function generateMetadata({ params }) {
  const { slug } = await params;

  const job = await getPublicJob(slug);

  if (!job || isPastDeadline(job)) {
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

export default async function KarirDetailLayout({ children, params }) {
  const { slug } = await params;

  // getPublicJob ber-cache per request: tidak ada query kedua setelah
  // generateMetadata. Lowongan tutup/tidak ada → buildJobPostingJsonLd null,
  // jadi tidak ada JSON-LD sama sekali.
  const job = await getPublicJob(slug);
  const jsonLd = buildJobPostingJsonLd(job);

  return (
    <>
      {jsonLd && (
        // Satu-satunya pemakaian dangerouslySetInnerHTML di repo: JSON-LD harus
        // berupa teks mentah di dalam <script>. serializeJsonLd meng-escape "<"
        // supaya isi database tidak bisa menutup tag script.
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      )}
      {children}
    </>
  );
}
