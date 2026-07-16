'use client';

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Building2,
  MapPin,
  Briefcase,
  Calendar,
  ArrowRight,
  SlidersHorizontal,
  SearchX,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';
import JobApplyForm from '@/components/JobApplyForm';

const translations = {
  id: {
    eyebrow: 'Bergabung Bersama Kami',
    title: 'Karir di Madael Consult',
    subtitle: 'Lihat lowongan yang tersedia dan bergabung dengan tim kami.',
    filterLabel: 'Filter',
    allDept: 'Semua Departemen',
    allLoc: 'Semua Lokasi',
    loading: 'Memuat lowongan...',
    errorPrefix: 'Gagal memuat data: ',
    empty: 'Belum ada lowongan yang sesuai filter.',
    closes: 'Deadline: ',
    viewDetail: 'Lihat Detail',
    viewFullPage: 'Buka halaman penuh',
    description: 'Deskripsi Pekerjaan',
    requirements: 'Kualifikasi',
    shareButton: 'Bagikan Lowongan',
    copied: 'Link disalin!',
    ctaTitle: 'Tidak menemukan posisi yang sesuai?',
    ctaSubtitle:
      'Kirimkan CV Anda kepada kami beserta posisi yang Anda minati — tim kami akan menghubungi jika ada kecocokan.',
    genOrContact: 'Atau hubungi kami langsung via',
    genOrContactLink: 'WhatsApp',
  },
  en: {
    eyebrow: 'Join Our Team',
    title: 'Careers at Madael Consult',
    subtitle: 'See open positions and join our team.',
    filterLabel: 'Filter',
    allDept: 'All Departments',
    allLoc: 'All Locations',
    loading: 'Loading jobs...',
    errorPrefix: 'Failed to load data: ',
    empty: 'No jobs match the current filter.',
    closes: 'Closes: ',
    viewDetail: 'View Detail',
    viewFullPage: 'Open full page',
    description: 'Job Description',
    requirements: 'Requirements',
    shareButton: 'Share Job',
    copied: 'Link copied!',
    ctaTitle: "Can't find the right position?",
    ctaSubtitle:
      "Send us your CV along with the position you're interested in — our team will reach out if there's a match.",
    genOrContact: 'Or reach us directly via',
    genOrContactLink: 'WhatsApp',
  },
};

export default function KarirPage() {
  const { lang } = useLanguage();
  const t = translations[lang];

  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [locationFilter, setLocationFilter] = useState('all');
  const [selectedSlug, setSelectedSlug] = useState(null);
  const [copiedSlug, setCopiedSlug] = useState(null);

  useEffect(() => {
    async function fetchJobs() {
      setLoading(true);
      const { data, error } = await supabase
        .from('job_listings')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) {
        setError(error.message);
      } else {
        setJobs(data || []);
      }
      setLoading(false);
    }

    fetchJobs();
  }, []);

  const departments = ['all', ...new Set(jobs.map((j) => j.department).filter(Boolean))];
  const locations = ['all', ...new Set(jobs.map((j) => j.location).filter(Boolean))];

  const filteredJobs = jobs.filter((job) => {
    const matchDept = departmentFilter === 'all' || job.department === departmentFilter;
    const matchLoc = locationFilter === 'all' || job.location === locationFilter;
    return matchDept && matchLoc;
  });

  // Lowongan yang sedang tampil di panel kanan (desktop). Default ke item
  // pertama kalau belum ada yang dipilih, atau kalau pilihan sebelumnya
  // tersaring keluar oleh filter.
  const selectedJob =
    filteredJobs.find((j) => j.slug === selectedSlug) || filteredJobs[0] || null;

  const formatDate = (dateStr) =>
    new Date(dateStr).toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-US', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

  const handleShare = async (job) => {
    const url = `${window.location.origin}/karir/${job.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSlug(job.slug);
      setTimeout(() => setCopiedSlug(null), 2000);
    } catch (err) {
      console.error('Clipboard error:', err);
    }
  };

  const selectClass =
    'border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  const renderTags = (job, size = 'sm') => {
    const isSm = size === 'sm';
    const textClass = isSm ? 'text-[11px]' : 'text-xs';
    const iconSize = isSm ? 11 : 12;
    return (
      <div className="flex flex-wrap gap-1.5">
        {job.department && (
          <span
            className={`inline-flex items-center gap-1 ${textClass} text-[#6B6B6B] bg-[#F4F4F4] px-2 py-0.5`}
          >
            <Building2 size={iconSize} />
            {job.department}
          </span>
        )}
        {job.location && (
          <span
            className={`inline-flex items-center gap-1 ${textClass} text-[#6B6B6B] bg-[#F4F4F4] px-2 py-0.5`}
          >
            <MapPin size={iconSize} />
            {job.location}
          </span>
        )}
        {job.type && (
          <span
            className={`inline-flex items-center gap-1 ${textClass} text-[#6B6B6B] bg-[#F4F4F4] px-2 py-0.5`}
          >
            <Briefcase size={iconSize} />
            {job.type}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
      {/* ============ HERO ============ */}
      <section className="bg-black px-10 py-16 border-b-4 border-madael-red">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-[11px] uppercase tracking-[0.18em] text-madael-red font-semibold mb-4">
            {t.eyebrow}
          </div>
          <h1 className="font-serif text-[36px] font-normal text-white tracking-[-0.02em] leading-[1.2] mb-3">
            {t.title}
          </h1>
          <p className="text-[#AAA] text-sm max-w-[480px]">{t.subtitle}</p>
        </div>
      </section>

      {/* ============ FILTER + LIST ============ */}
      <section className="px-10 py-10 bg-white">
        <div className="max-w-[1100px] mx-auto">
          <div className="flex flex-wrap items-center gap-4 mb-8">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B6B6B] tracking-[0.04em] uppercase">
              <SlidersHorizontal size={14} />
              {t.filterLabel}
            </span>

            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className={selectClass}
            >
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d === 'all' ? t.allDept : d}
                </option>
              ))}
            </select>

            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className={selectClass}
            >
              {locations.map((l) => (
                <option key={l} value={l}>
                  {l === 'all' ? t.allLoc : l}
                </option>
              ))}
            </select>
          </div>

          {loading && <p className="text-sm text-[#6B6B6B]">{t.loading}</p>}

          {error && (
            <p className="text-sm text-madael-red">
              {t.errorPrefix}
              {error}
            </p>
          )}

          {!loading && !error && filteredJobs.length === 0 && (
            <div className="border border-dashed border-[#E0E0E0] p-10 text-center">
              <SearchX size={28} className="mx-auto mb-3 text-[#AAA]" strokeWidth={1.5} />
              <p className="text-sm text-[#6B6B6B]">{t.empty}</p>
            </div>
          )}

          {!loading && !error && filteredJobs.length > 0 && (
            <>
              {/* ===== DESKTOP: master-detail (lg ke atas) ===== */}
              <div className="hidden lg:flex gap-8 items-start">
                <div className="w-[360px] flex-shrink-0 flex flex-col gap-3 lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto lg:pr-1">
                  {filteredJobs.map((job) => {
                    const isActive = selectedJob?.slug === job.slug;
                    return (
                      <button
                        key={job.id}
                        type="button"
                        onClick={() => setSelectedSlug(job.slug)}
                        className={`w-full text-left p-4 border transition-colors ${
                          isActive
                            ? 'border-madael-red bg-[#FFF6F6]'
                            : 'border-[#E0E0E0] bg-white hover:border-madael-red/40 hover:bg-[#FAFAFA]'
                        }`}
                      >
                        <h3
                          className={`font-serif text-[16px] font-normal tracking-[-0.01em] mb-2 ${
                            isActive ? 'text-madael-red' : 'text-black'
                          }`}
                        >
                          {job.title}
                        </h3>
                        {renderTags(job, 'sm')}
                        {job.closes_at && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-madael-red mt-2">
                            <Calendar size={11} />
                            {t.closes}
                            {formatDate(job.closes_at)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex-1 lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto">
                  {selectedJob && (
                    <div className="border border-[#E0E0E0] bg-white">
                      <div className="p-8 border-b border-[#E0E0E0]">
                        <h2 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] leading-[1.2] mb-3">
                          {selectedJob.title}
                        </h2>
                        {renderTags(selectedJob, 'md')}
                        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                          {selectedJob.closes_at ? (
                            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-madael-red">
                              <Calendar size={14} />
                              {t.closes}
                              {formatDate(selectedJob.closes_at)}
                            </span>
                          ) : (
                            <span />
                          )}
                          <div className="flex items-center gap-4">
                            <Link
                              href={`/karir/${selectedJob.slug}`}
                              className="inline-flex items-center gap-1 text-xs text-[#6B6B6B] hover:text-madael-red no-underline transition-colors"
                            >
                              <ExternalLink size={12} />
                              {t.viewFullPage}
                            </Link>
                            <button
                              onClick={() => handleShare(selectedJob)}
                              className="text-sm text-[#6B6B6B] hover:text-madael-red transition-colors"
                            >
                              {copiedSlug === selectedJob.slug ? t.copied : t.shareButton}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="p-8 space-y-8">
                        {selectedJob.description && (
                          <div>
                            <h3 className="font-serif text-[20px] font-normal text-black tracking-[-0.02em] mb-4 border-l-[3px] border-madael-red pl-4">
                              {t.description}
                            </h3>
                            <div
                              className="text-sm text-[#3D3D3D] leading-relaxed whitespace-pre-line"
                              dangerouslySetInnerHTML={{ __html: selectedJob.description }}
                            />
                          </div>
                        )}

                        {selectedJob.requirements && (
                          <div>
                            <h3 className="font-serif text-[20px] font-normal text-black tracking-[-0.02em] mb-4 border-l-[3px] border-madael-red pl-4">
                              {t.requirements}
                            </h3>
                            <div
                              className="text-sm text-[#3D3D3D] leading-relaxed whitespace-pre-line"
                              dangerouslySetInnerHTML={{ __html: selectedJob.requirements }}
                            />
                          </div>
                        )}

                        <JobApplyForm
                          key={selectedJob.id}
                          mode="job"
                          jobId={selectedJob.id}
                          jobTitle={selectedJob.title}
                          anchorId="apply-detail"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ===== MOBILE/TABLET: card list -> navigasi ke /karir/[slug] ===== */}
              <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-5">
                {filteredJobs.map((job) => (
                  <Link
                    key={job.id}
                    href={`/karir/${job.slug}`}
                    className="group flex flex-col border border-[#E0E0E0] bg-white p-6 no-underline shadow-sm hover:shadow-md hover:border-madael-red/40 transition-all duration-150"
                  >
                    <h3 className="font-serif text-[19px] font-normal text-black tracking-[-0.01em] mb-3 group-hover:text-madael-red transition-colors">
                      {job.title}
                    </h3>

                    <div className="mb-4">{renderTags(job, 'md')}</div>

                    <div className="mt-auto pt-4 border-t border-[#E0E0E0] flex items-center justify-between gap-3">
                      {job.closes_at ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-madael-red">
                          <Calendar size={13} />
                          {t.closes}
                          {formatDate(job.closes_at)}
                        </span>
                      ) : (
                        <span />
                      )}

                      <span className="inline-flex items-center gap-1 text-sm font-medium text-black group-hover:text-madael-red group-hover:gap-2 transition-all whitespace-nowrap">
                        {t.viewDetail}
                        <ArrowRight size={14} />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ============ CTA — LAMARAN UMUM ============ */}
      <section className="px-10 py-16 bg-[#F4F4F4] border-t border-[#E0E0E0]">
        <div className="max-w-[600px] mx-auto text-center mb-8">
          <h3 className="font-serif text-[24px] font-normal text-black tracking-[-0.02em] mb-3">
            {t.ctaTitle}
          </h3>
          <p className="text-sm text-[#6B6B6B]">{t.ctaSubtitle}</p>
        </div>

        <div className="max-w-[600px] mx-auto">
          <JobApplyForm mode="general" anchorId="apply-general" showHeading={false} />
          <p className="text-center text-xs text-[#6B6B6B] mt-4">
            {t.genOrContact}{' '}
            <a
              href="https://wa.me/6285121548247?text=Halo%20Madael%20Consult%2C%20saya%20ingin%20menanyakan%20lowongan%20kerja."
              target="_blank"
              rel="noopener noreferrer"
              className="text-madael-red hover:text-madael-dark font-medium no-underline"
            >
              {t.genOrContactLink}
            </a>
          </p>
        </div>
      </section>
    </>
  );
}