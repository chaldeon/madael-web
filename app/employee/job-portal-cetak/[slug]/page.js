'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { createClient } from '@/lib/supabase-browser';

function toBullets(text) {
  return (text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

export default function CetakLowonganPage() {
  const params = useParams();
  const supabase = createClient();
  const { status } = useModuleAccess('job_portal');

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const posterRef = useRef(null);

  const handlePrint = () => {
    const posterEl = posterRef.current;
    if (posterEl) {
      const rect = posterEl.getBoundingClientRect();
      const width = Math.ceil(rect.width);
      const height = Math.ceil(rect.height);

      let styleTag = document.getElementById('dynamic-page-size');
      if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'dynamic-page-size';
        document.head.appendChild(styleTag);
      }
      // Ukuran halaman PDF dibuat pas dengan tinggi konten sebenarnya (full-bleed, tanpa margin),
      // supaya tidak ada sisa halaman kosong di bawah, apapun ukuran kertas yang dipilih di dialog print.
      styleTag.textContent = `@page { size: ${width}px ${height}px; margin: 0; }`;
    }
    window.print();
  };

  const loadJob = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from('job_listings')
      .select('*')
      .eq('slug', params.slug)
      .maybeSingle();

    if (error) {
      setError(error.message);
    } else if (!data) {
      setError('Lowongan tidak ditemukan.');
    } else {
      setJob(data);
    }
    setLoading(false);
  }, [supabase, params.slug]);

  useEffect(() => {
    if (status === 'allowed') loadJob();
  }, [status, loadJob]);

  if (status === 'loading' || (status === 'allowed' && loading)) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
      </section>
    );
  }

  if (status === 'denied') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Kamu tidak punya akses ke modul Job Portal.</p>
          <Link
            href="/employee/dashboard"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali ke Dashboard
          </Link>
        </div>
      </section>
    );
  }

  if (error || !job) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-madael-red mb-6">{error}</p>
          <Link
            href="/employee/job-portal"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali ke Lowongan
          </Link>
        </div>
      </section>
    );
  }

  const closesLabel = formatDate(job.closes_at);
  const metaLine = [job.department, job.location, job.type].filter(Boolean).join('   ·   ');
  const descBullets = toBullets(job.description);
  const reqBullets = toBullets(job.requirements);

  return (
    <section className="min-h-screen bg-[#F4F4F4]">
      <div className="max-w-[820px] mx-auto px-6 py-10 print:py-0 print:px-0 print:max-w-none">
        <div className="print:hidden flex items-center justify-between mb-4">
          <Link href="/employee/job-portal" className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-black">
            <ArrowLeft size={15} />
            Kembali ke Lowongan
          </Link>
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors"
          >
            <Printer size={15} />
            Cetak / Simpan PDF
          </button>
        </div>

        {/* Poster job-ad — pakai aset asli dari template (ripple, dot cluster, watermark logo) */}
        <div
          ref={posterRef}
          className="relative overflow-hidden bg-[#F3F1EC] print:bg-[#F3F1EC] p-10 md:p-16"
          style={{ WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
        >
          <img
            src="/job-ad/ripple-top-left.png"
            alt=""
            width={260}
            height={286}
            className="absolute top-0 left-0 pointer-events-none select-none"
          />
          <img
            src="/job-ad/ripple-bottom-right.png"
            alt=""
            width={280}
            height={282}
            className="absolute bottom-0 right-0 pointer-events-none select-none"
          />
          <img
            src="/job-ad/dots-top-right.png"
            alt=""
            width={56}
            height={70}
            className="absolute top-6 right-6 pointer-events-none select-none"
          />
          <img
            src="/job-ad/dots-bottom-left.png"
            alt=""
            width={56}
            height={104}
            className="absolute bottom-6 left-6 pointer-events-none select-none"
          />
          <img
            src="/job-ad/watermark-logo.png"
            alt=""
            width={300}
            height={302}
            className="absolute pointer-events-none select-none"
            style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
          />

          <div className="relative">
            <h1 className="font-sans font-extrabold uppercase text-black text-[28px] md:text-[34px] leading-[1.15] tracking-tight mb-1">
              We Are Looking For
            </h1>
            <h2 className="font-sans font-extrabold uppercase text-black text-[30px] md:text-[38px] leading-[1.15] tracking-tight underline decoration-black underline-offset-[6px] mb-6">
              {job.title}
            </h2>

            {job.client_industry && (
              <p className="font-bold text-sm text-black leading-relaxed mb-1">
                Our client in {job.client_industry}, is looking for a talent with details below:
              </p>
            )}
            <p className="text-xs text-[#6B6B6B] mb-8">
              {metaLine}
              {closesLabel && <span className="text-madael-red"> &nbsp;·&nbsp; Deadline: {closesLabel}</span>}
            </p>

            {descBullets.length > 0 && (
              <div className="mb-8">
                <h3 className="font-sans font-extrabold uppercase text-black text-[18px] underline decoration-black underline-offset-[4px] mb-3">
                  Job Descriptions
                </h3>
                <ul className="space-y-2">
                  {descBullets.map((line, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-black leading-relaxed">
                      <span className="text-black mt-[2px]">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {reqBullets.length > 0 && (
              <div className="mb-8">
                <h3 className="font-sans font-extrabold uppercase text-black text-[18px] underline decoration-black underline-offset-[4px] mb-3">
                  Requirements
                </h3>
                <ul className="space-y-2">
                  {reqBullets.map((line, i) => (
                    <li key={i} className="flex gap-2.5 text-sm text-black leading-relaxed">
                      <span className="text-black mt-[2px]">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="text-center pt-4 pb-2">
              <p className="text-sm text-black">
                If you meet the requirements above, please send your application to{' '}
                <span className="font-bold">hr@madaelconsult.com</span> and cc to{' '}
                <span className="font-bold">daniel@madaelconsult.com</span>
              </p>
              <p className="text-sm text-black italic underline mt-1">
                Only shortlisted candidates will be processed further.
              </p>
              <p className="text-xs text-[#6B6B6B] mt-3">www.madaelconsult.com</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}