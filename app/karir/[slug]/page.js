'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/context/LanguageContext';

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
    // Form apply
    applyTitle: 'Lamar Posisi Ini',
    applySubtitle: 'Isi data di bawah dan lampirkan CV Anda (PDF, maks. 5MB).',
    fieldName: 'Nama Lengkap',
    fieldEmail: 'Email',
    fieldPhone: 'Nomor Telepon',
    fieldCV: 'Upload CV (PDF, maks. 5MB)',
    submitButton: 'Kirim Lamaran',
    submitting: 'Mengirim...',
    successTitle: 'Lamaran berhasil dikirim!',
    successBody: 'Terima kasih sudah melamar. Tim kami akan meninjau CV Anda dan menghubungi jika ada kecocokan.',
    errFileType: 'File harus berformat PDF.',
    errFileSize: 'Ukuran file maksimal 5MB.',
    errGeneric: 'Terjadi kesalahan. Silakan coba lagi.',
    required: 'wajib diisi',
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
    // Form apply
    applyTitle: 'Apply for This Position',
    applySubtitle: 'Fill in your details below and attach your CV (PDF, max 5MB).',
    fieldName: 'Full Name',
    fieldEmail: 'Email',
    fieldPhone: 'Phone Number',
    fieldCV: 'Upload CV (PDF, max 5MB)',
    submitButton: 'Submit Application',
    submitting: 'Submitting...',
    successTitle: 'Application submitted!',
    successBody: "Thank you for applying. Our team will review your CV and reach out if there's a match.",
    errFileType: 'File must be a PDF.',
    errFileSize: 'File size must be under 5MB.',
    errGeneric: 'Something went wrong. Please try again.',
    required: 'is required',
  },
};

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export default function KarirDetailPage() {
  const { lang } = useLanguage();
  const t = translations[lang];
  const params = useParams();
  const { slug } = params;

  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // Apply form state
  const [form, setForm] = useState({ nama: '', email: '', telepon: '' });
  const [cvFile, setCvFile] = useState(null);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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

  const handleFieldChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    setFormError(null);
    if (!file) {
      setCvFile(null);
      return;
    }
    if (file.type !== 'application/pdf') {
      setFormError(t.errFileType);
      setCvFile(null);
      e.target.value = '';
      return;
    }
    if (file.size > MAX_SIZE) {
      setFormError(t.errFileSize);
      setCvFile(null);
      e.target.value = '';
      return;
    }
    setCvFile(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!form.nama || !form.email || !cvFile) {
      setFormError(t.errGeneric);
      return;
    }

    setSubmitting(true);
    try {
      const payload = new FormData();
      payload.append('nama', form.nama);
      payload.append('email', form.email);
      payload.append('telepon', form.telepon);
      payload.append('job_id', job.id);
      payload.append('posisi', job.title);
      payload.append('cv', cvFile);

      const res = await fetch('/api/apply', {
        method: 'POST',
        body: payload,
      });

      const result = await res.json();

      if (!res.ok) {
        setFormError(result.error || t.errGeneric);
      } else {
        setSubmitted(true);
        setForm({ nama: '', email: '', telepon: '' });
        setCvFile(null);
      }
    } catch (err) {
      console.error('Submit error:', err);
      setFormError(t.errGeneric);
    } finally {
      setSubmitting(false);
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

  const inputClass =
    'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';

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

          {/* ============ APPLY FORM ============ */}
          <div id="apply" className="border border-[#E0E0E0] p-8">
            <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] mb-2">
              {t.applyTitle}
            </h2>

            {submitted ? (
              <div className="border border-[#C9E7CF] bg-[#F2FAF3] p-6 mt-4">
                <p className="text-sm font-medium text-[#1E7A34] mb-1">{t.successTitle}</p>
                <p className="text-sm text-[#3D3D3D]">{t.successBody}</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-[#6B6B6B] mb-6">{t.applySubtitle}</p>

                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label htmlFor="nama" className={labelClass}>
                      {t.fieldName}
                    </label>
                    <input
                      id="nama"
                      name="nama"
                      type="text"
                      required
                      value={form.nama}
                      onChange={handleFieldChange}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label htmlFor="email" className={labelClass}>
                      {t.fieldEmail}
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      value={form.email}
                      onChange={handleFieldChange}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label htmlFor="telepon" className={labelClass}>
                      {t.fieldPhone}
                    </label>
                    <input
                      id="telepon"
                      name="telepon"
                      type="tel"
                      value={form.telepon}
                      onChange={handleFieldChange}
                      className={inputClass}
                    />
                  </div>

                  <div>
                    <label htmlFor="cv" className={labelClass}>
                      {t.fieldCV}
                    </label>
                    <input
                      id="cv"
                      name="cv"
                      type="file"
                      accept="application/pdf"
                      required
                      onChange={handleFileChange}
                      className="w-full text-sm text-[#3D3D3D] file:mr-4 file:py-2 file:px-4 file:border-0 file:text-sm file:font-medium file:bg-[#F4F4F4] file:text-[#3D3D3D] hover:file:bg-[#E8E8E8] file:cursor-pointer cursor-pointer"
                    />
                  </div>

                  {formError && <p className="text-sm text-madael-red">{formError}</p>}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {submitting ? t.submitting : t.submitButton}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}