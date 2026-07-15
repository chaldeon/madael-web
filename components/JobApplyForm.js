'use client';

import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

const translations = {
  id: {
    applyTitleJob: 'Lamar Posisi Ini',
    applySubtitleJob: 'Isi data di bawah dan lampirkan CV Anda (PDF, maks. 5MB).',
    fieldName: 'Nama Lengkap',
    fieldEmail: 'Email',
    fieldPhone: 'Nomor Telepon',
    fieldPosition: 'Posisi yang Diminati',
    fieldPositionPlaceholder: 'Contoh: HR Business Partner, Legal Officer',
    fieldCV: 'Upload CV (PDF, maks. 5MB)',
    submitButton: 'Kirim Lamaran',
    submitButtonGeneral: 'Kirim CV',
    submitting: 'Mengirim...',
    successTitle: 'Lamaran berhasil dikirim!',
    successBody:
      'Terima kasih sudah melamar. Tim kami akan meninjau CV Anda dan menghubungi jika ada kecocokan.',
    successTitleGeneral: 'CV berhasil dikirim!',
    successBodyGeneral:
      'Terima kasih sudah menghubungi kami. Tim kami akan meninjau CV Anda dan menghubungi jika ada posisi yang cocok.',
    errFileType: 'File harus berformat PDF.',
    errFileSize: 'Ukuran file maksimal 5MB.',
    errRequiredJob: 'Nama, email, dan CV wajib diisi.',
    errRequiredGeneral: 'Nama, email, posisi yang diminati, dan CV wajib diisi.',
    errGeneric: 'Terjadi kesalahan. Silakan coba lagi.',
  },
  en: {
    applyTitleJob: 'Apply for This Position',
    applySubtitleJob: 'Fill in your details below and attach your CV (PDF, max 5MB).',
    fieldName: 'Full Name',
    fieldEmail: 'Email',
    fieldPhone: 'Phone Number',
    fieldPosition: 'Position of Interest',
    fieldPositionPlaceholder: 'e.g. HR Business Partner, Legal Officer',
    fieldCV: 'Upload CV (PDF, max 5MB)',
    submitButton: 'Submit Application',
    submitButtonGeneral: 'Send CV',
    submitting: 'Submitting...',
    successTitle: 'Application submitted!',
    successBody:
      "Thank you for applying. Our team will review your CV and reach out if there's a match.",
    successTitleGeneral: 'CV sent successfully!',
    successBodyGeneral:
      "Thank you for reaching out. Our team will review your CV and contact you if there's a matching role.",
    errFileType: 'File must be a PDF.',
    errFileSize: 'File size must be under 5MB.',
    errRequiredJob: 'Name, email, and CV are required.',
    errRequiredGeneral: 'Name, email, position of interest, and CV are required.',
    errGeneric: 'Something went wrong. Please try again.',
  },
};

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Shared apply form.
 * mode="job"     -> apply ke satu lowongan spesifik (butuh jobId + jobTitle)
 * mode="general" -> lamaran umum, tanpa job_id, dengan field "posisi yang diminati"
 */
export default function JobApplyForm({
  mode = 'job',
  jobId,
  jobTitle,
  anchorId = 'apply',
  showHeading = true,
}) {
  const { lang } = useLanguage();
  const t = translations[lang];
  const isGeneral = mode === 'general';

  const [form, setForm] = useState({ nama: '', email: '', telepon: '', posisi_minat: '' });
  const [cvFile, setCvFile] = useState(null);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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

    if (!form.nama || !form.email || !cvFile || (isGeneral && !form.posisi_minat)) {
      setFormError(isGeneral ? t.errRequiredGeneral : t.errRequiredJob);
      return;
    }

    setSubmitting(true);
    try {
      const payload = new FormData();
      payload.append('nama', form.nama);
      payload.append('email', form.email);
      payload.append('telepon', form.telepon);

      if (isGeneral) {
        // Tidak mengirim job_id -> API memperlakukan ini sebagai lamaran umum
        // (folder Google Drive "Umum", job_id null di Supabase)
        payload.append('posisi_minat', form.posisi_minat);
      } else {
        payload.append('job_id', jobId);
        payload.append('posisi', jobTitle);
      }
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
        setForm({ nama: '', email: '', telepon: '', posisi_minat: '' });
        setCvFile(null);
      }
    } catch (err) {
      console.error('Submit error:', err);
      setFormError(t.errGeneric);
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';
  const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';

  return (
    <div id={anchorId} className="border border-[#E0E0E0] bg-white p-8">
      {showHeading && !isGeneral && (
        <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] mb-2">
          {t.applyTitleJob}
        </h2>
      )}

      {submitted ? (
        <div className="border border-[#C9E7CF] bg-[#F2FAF3] p-6 mt-4">
          <p className="text-sm font-medium text-[#1E7A34] mb-1">
            {isGeneral ? t.successTitleGeneral : t.successTitle}
          </p>
          <p className="text-sm text-[#3D3D3D]">
            {isGeneral ? t.successBodyGeneral : t.successBody}
          </p>
        </div>
      ) : (
        <>
          {showHeading && !isGeneral && (
            <p className="text-sm text-[#6B6B6B] mb-6">{t.applySubtitleJob}</p>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor={`${anchorId}-nama`} className={labelClass}>
                {t.fieldName}
              </label>
              <input
                id={`${anchorId}-nama`}
                name="nama"
                type="text"
                required
                value={form.nama}
                onChange={handleFieldChange}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor={`${anchorId}-email`} className={labelClass}>
                {t.fieldEmail}
              </label>
              <input
                id={`${anchorId}-email`}
                name="email"
                type="email"
                required
                value={form.email}
                onChange={handleFieldChange}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor={`${anchorId}-telepon`} className={labelClass}>
                {t.fieldPhone}
              </label>
              <input
                id={`${anchorId}-telepon`}
                name="telepon"
                type="tel"
                value={form.telepon}
                onChange={handleFieldChange}
                className={inputClass}
              />
            </div>

            {isGeneral && (
              <div>
                <label htmlFor={`${anchorId}-posisi`} className={labelClass}>
                  {t.fieldPosition}
                </label>
                <input
                  id={`${anchorId}-posisi`}
                  name="posisi_minat"
                  type="text"
                  required
                  placeholder={t.fieldPositionPlaceholder}
                  value={form.posisi_minat}
                  onChange={handleFieldChange}
                  className={inputClass}
                />
              </div>
            )}

            <div>
              <label htmlFor={`${anchorId}-cv`} className={labelClass}>
                {t.fieldCV}
              </label>
              <input
                id={`${anchorId}-cv`}
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
              className="w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? t.submitting : isGeneral ? t.submitButtonGeneral : t.submitButton}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
