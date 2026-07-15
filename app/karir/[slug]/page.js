'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import JobApplyForm from '@/components/JobApplyForm';

const translations = {
  id: {
    back: '← Kembali ke daftar lowongan',
    loading: 'Memuat lowongan...',
    errorPrefix: 'Gagal memuat data: ',
    notFound: 'Lowongan tidak ditemukan atau sudah tidak aktif.',
    closes: 'Deadline: ',
    description: 'Deskripsi Pekerjaan',
    requirements: 'Kualifikasi',
    applyButton: 'Apply Sekarang',
    shareButton: 'Bagikan Lowongan',
    copied: 'Link disalin!',
  },
  en: {
    back: '← Back to job listings',
    loading: 'Loading job...',
    errorPrefix: 'Failed to load data: ',
    notFound: 'Job not found or no longer active.',
    closes: 'Closes: ',
    description: 'Job Description',
    requirements: 'Requirements',
    applyButton: 'Apply Now',
    shareButton: 'Share Job',
    copied: 'Link copied!',
  },
};

export default function KarirDetailPage() {
  const { lang } = useLanguage();
  const t = translations[lang];
  const params = useParams();
  const { slug } = params;

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchJob() {
      setLoading(true);
      const { data, error } = await supabase
        .from('job_listings')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .single();

      if (error) {
        setError(error.message);
      } else {
        setJob(data);
      }
      setLoading(false);
    }

    if (slug) fetchJob();
  }, [slug]);

  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Clipboard error:', err);
    }
  };

  if (loading) {
    return (
      <section className="px-10 py-16 bg-white">
        <div className="max-w-[900px] mx-auto">
          <p className="text-sm text-[#6B6B6B]">{t.loading}</p>
        </div>
      </section>
    );
  }

  if (error || !job) {
    return (
      <section className="px-10 py-16 bg-white">
        <div className="max-w-[900px] mx-auto">
          <p className="text-sm text-madael-red mb-4">
            {error ? `${t.errorPrefix}${error}` : t.notFound}
          </p>
          <Link href="/karir" className="text-sm text-madael-red hover:text-madael-dark no-underline">
            {t.back}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <>
      {/* ============ HERO ============ */}
      <section className="bg-black px-10 py-16 border-b-4 border-madael-red">
        <div className="max-w-[900px] mx-auto">
          <Link
            href="/karir"
            className="inline-block text-xs text-[#AAA] hover:text-white mb-6 no-underline transition-colors"
          >
            {t.back}
          </Link>
          <h1 className="font-serif text-[36px] font-normal text-white tracking-[-0.02em] leading-[1.2] mb-4">
            {job.title}
          </h1>
          <div className="flex flex-wrap gap-2 text-sm text-[#AAA]">
            {job.department && <span>{job.department}</span>}
            {job.department && job.location && <span>·</span>}
            {job.location && <span>{job.location}</span>}
            {job.location && job.type && <span>·</span>}
            {job.type && <span>{job.type}</span>}
          </div>
          {job.closes_at && (
            <p className="text-xs text-madael-red mt-4">
              {t.closes}
              {new Date(job.closes_at).toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-US', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          )}
        </div>
      </section>

      {/* ============ CONTENT ============ */}
      <section className="px-10 py-10 bg-white">
        <div className="max-w-[900px] mx-auto">
          {/* Action buttons */}
          <div className="flex flex-wrap gap-3 mb-10">
            <a
              href="#apply"
              className="bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
            >
              {t.applyButton}
            </a>
            <button
              onClick={handleShare}
              className="border border-[#E0E0E0] text-[#6B6B6B] px-8 py-3 text-sm font-medium tracking-[0.04em] hover:border-madael-red hover:text-madael-red transition-colors"
            >
              {copied ? t.copied : t.shareButton}
            </button>
          </div>

          {/* Description */}
          {job.description && (
            <div className="mb-10">
              <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] mb-4 border-l-[3px] border-madael-red pl-4">
                {t.description}
              </h2>
              <div
                className="text-sm text-[#3D3D3D] leading-relaxed whitespace-pre-line"
                dangerouslySetInnerHTML={{ __html: job.description }}
              />
            </div>
          )}

          {/* Requirements */}
          {job.requirements && (
            <div className="mb-10">
              <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] mb-4 border-l-[3px] border-madael-red pl-4">
                {t.requirements}
              </h2>
              <div
                className="text-sm text-[#3D3D3D] leading-relaxed whitespace-pre-line"
                dangerouslySetInnerHTML={{ __html: job.requirements }}
              />
            </div>
          )}

          {/* ============ APPLY FORM (shared component) ============ */}
          <JobApplyForm mode="job" jobId={job.id} jobTitle={job.title} anchorId="apply" />
        </div>
      </section>
    </>
  );
}
