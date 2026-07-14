'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';

const translations = {
  id: {
    eyebrow: 'Bergabung Bersama Kami',
    title: 'Karir di Madael Consult',
    subtitle: 'Lihat lowongan yang tersedia dan bergabung dengan tim kami.',
    allDept: 'Semua Departemen',
    allLoc: 'Semua Lokasi',
    loading: 'Memuat lowongan...',
    errorPrefix: 'Gagal memuat data: ',
    empty: 'Belum ada lowongan yang sesuai filter.',
    closes: 'Deadline: ',
    ctaTitle: 'Tidak menemukan posisi yang sesuai?',
    ctaSubtitle: 'Kirimkan CV Anda kepada kami, kami akan menghubungi jika ada posisi yang cocok.',
    ctaButton: 'Hubungi Madael Consult',
  },
  en: {
    eyebrow: 'Join Our Team',
    title: 'Careers at Madael Consult',
    subtitle: 'See open positions and join our team.',
    allDept: 'All Departments',
    allLoc: 'All Locations',
    loading: 'Loading jobs...',
    errorPrefix: 'Failed to load data: ',
    empty: 'No jobs match the current filter.',
    closes: 'Closes: ',
    ctaTitle: "Can't find the right position?",
    ctaSubtitle: "Send us your CV and we'll reach out when a matching role opens up.",
    ctaButton: 'Contact Madael Consult',
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

  const selectClass =
    'border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

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
          <div className="flex flex-wrap gap-4 mb-10">
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
            <div className="border border-dashed border-[#E0E0E0] p-10 text-center text-sm text-[#6B6B6B]">
              {t.empty}
            </div>
          )}

          {!loading && !error && filteredJobs.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 border-t border-l border-[#E0E0E0]">
              {filteredJobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/karir/${job.slug}`}
                  className="group border-r border-b border-[#E0E0E0] p-6 no-underline hover:bg-[#FAFAFA] transition-colors"
                >
                  <h3 className="font-serif text-[19px] font-normal text-black tracking-[-0.01em] mb-2 group-hover:text-madael-red transition-colors">
                    {job.title}
                  </h3>
                  <div className="flex flex-wrap gap-2 text-xs text-[#6B6B6B] mb-3">
                    {job.department && <span>{job.department}</span>}
                    {job.department && job.location && <span>·</span>}
                    {job.location && <span>{job.location}</span>}
                    {job.location && job.type && <span>·</span>}
                    {job.type && <span>{job.type}</span>}
                  </div>
                  {job.closes_at && (
                    <p className="text-xs text-[#6B6B6B]">
                      {t.closes}
                      {new Date(job.closes_at).toLocaleDateString(
                        lang === 'id' ? 'id-ID' : 'en-US',
                        { day: 'numeric', month: 'long', year: 'numeric' }
                      )}
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ============ CTA ============ */}
      <section className="px-10 py-16 bg-[#F4F4F4] border-t border-[#E0E0E0] text-center">
        <h3 className="font-serif text-[24px] font-normal text-black tracking-[-0.02em] mb-3">
          {t.ctaTitle}
        </h3>
        <p className="text-sm text-[#6B6B6B] mb-6 max-w-[480px] mx-auto">{t.ctaSubtitle}</p>
        <a
          href="https://wa.me/6285121548247?text=Halo%20Madael%20Consult%2C%20saya%20ingin%20menanyakan%20lowongan%20kerja."
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
        >
          {t.ctaButton}
        </a>
      </section>
    </>
  );
}