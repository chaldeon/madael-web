'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { callJsonApi } from '@/lib/apiClient';
import { friendlyCaught } from '@/lib/errorMessage';
import {
  FREELANCER_ADMIN_BASE,
  FREELANCER_CV_MIME,
  FREELANCER_CV_LABEL_JENIS,
  emptyFreelancerForm,
  hariIniWib,
  validateFreelancerInput,
} from '@/lib/freelancerAdminConfig';
import { UPLOAD_MAX_BYTES, PESAN_UKURAN_UPLOAD, readUploadJson } from '@/lib/uploadLimits';
import FreelancerForm from '@/components/freelancer-admin/FreelancerForm';

const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';

export default function TambahFreelancerPage() {
  // Tanggal bergabung diisi hari ini (WIB) sebagai saran; admin boleh mengubahnya.
  const [form, setForm] = useState(() => ({ ...emptyFreelancerForm, tanggal_bergabung: hariIniWib() }));
  const [cvFile, setCvFile] = useState(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [created, setCreated] = useState(null); // { id, freelancer_code, nama_lengkap, email, cvError }

  const handleChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleCvPick = (e) => {
    const file = e.target.files?.[0] || null;
    setFormError(null);
    if (file) {
      if (!FREELANCER_CV_MIME[file.type]) {
        setFormError(`Format CV harus ${FREELANCER_CV_LABEL_JENIS}.`);
        setFileInputKey((k) => k + 1);
        setCvFile(null);
        return;
      }
      if (file.size > UPLOAD_MAX_BYTES) {
        setFormError(PESAN_UKURAN_UPLOAD);
        setFileInputKey((k) => k + 1);
        setCvFile(null);
        return;
      }
    }
    setCvFile(file);
  };

  const resetForm = () => {
    setForm({ ...emptyFreelancerForm, tanggal_bergabung: hariIniWib() });
    setCvFile(null);
    setFileInputKey((k) => k + 1);
    setFormError(null);
    setCreated(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);

    // Validasi cepat di browser; server memvalidasi ulang dan menjadi penjaganya.
    const { error: validationError } = validateFreelancerInput(form, { mode: 'create' });
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSubmitting(true);
    const res = await callJsonApi('/api/freelancers', 'POST', form);
    if (!res.ok) {
      setFormError(res.error);
      setSubmitting(false);
      return;
    }
    const fl = res.data.freelancer;

    // CV diunggah setelah akun jadi. Kegagalan upload tidak membatalkan akun:
    // admin dapat mengunggah ulang dari halaman detail.
    let cvError = null;
    if (cvFile) {
      try {
        const fd = new FormData();
        fd.append('file', cvFile);
        const upRes = await fetch(`/api/freelancers/${fl.id}/cv`, { method: 'POST', body: fd });
        await readUploadJson(upRes, 'Gagal mengupload CV.');
      } catch (err) {
        cvError = friendlyCaught(err, 'Gagal mengupload CV.', { context: 'Upload CV Freelancer' });
      }
    }

    setCreated({ ...fl, cvError });
    setSubmitting(false);
  };

  if (created) {
    return (
      <div className="max-w-[640px] mx-auto px-6 py-10">
        <div className="bg-white border border-[#E0E0E0] border-t-4 border-t-[#166534] p-8">
          <div className="flex items-start gap-3 mb-4">
            <CheckCircle2 size={22} className="text-[#166534] shrink-0 mt-0.5" />
            <div>
              <h1 className="font-serif text-[22px] font-normal text-black">Freelancer berhasil ditambahkan</h1>
              <p className="text-sm text-[#6B6B6B] mt-1">
                <strong className="text-black">{created.nama_lengkap}</strong> mendapat Freelancer ID{' '}
                <strong className="text-black">{created.freelancer_code}</strong>. Email undangan untuk membuat
                password sudah dikirim ke <strong className="text-black">{created.email}</strong>.
              </p>
            </div>
          </div>

          {created.cvError && (
            <div className="flex items-start gap-2 border-l-4 border-madael-red bg-[#FFF5F5] p-3 mb-4">
              <AlertTriangle size={16} className="text-madael-red shrink-0 mt-0.5" />
              <p className="text-sm text-black">
                Akun sudah dibuat, tetapi CV belum terunggah: {created.cvError} Unggah ulang dari halaman detail.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-3 mt-6">
            <Link
              href={`${FREELANCER_ADMIN_BASE}/${created.id}`}
              className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
            >
              Lihat Detail
            </Link>
            <button
              type="button"
              onClick={resetForm}
              className="border border-[#E0E0E0] text-black px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:border-madael-red hover:text-madael-red transition-colors"
            >
              Tambah Lagi
            </button>
            <Link
              href={FREELANCER_ADMIN_BASE}
              className="border border-[#E0E0E0] text-black px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:border-madael-red hover:text-madael-red transition-colors"
            >
              Kembali ke Daftar
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[640px] mx-auto px-6 py-10">
      <Link href={FREELANCER_ADMIN_BASE} className="text-sm text-[#6B6B6B] hover:text-black">
        ← Daftar Freelancer
      </Link>
      <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mt-3 mb-1">
        Tambah Freelancer
      </h1>
      <p className="text-sm text-[#6B6B6B] mb-8">
        Setelah disimpan, sistem membuat akun login, memberi Freelancer ID otomatis, dan mengirim email undangan.
      </p>

      <form onSubmit={handleSubmit} className="bg-white border border-[#E0E0E0] p-6 space-y-4" noValidate>
        <FreelancerForm form={form} onChange={handleChange} disabled={submitting} />

        <div>
          <label htmlFor="fl-cv" className={labelClass}>CV (opsional)</label>
          <input
            key={fileInputKey}
            id="fl-cv"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            disabled={submitting}
            onChange={handleCvPick}
            className="block w-full text-sm text-[#6B6B6B] file:mr-3 file:border file:border-[#E0E0E0] file:bg-white file:px-4 file:py-2 file:text-sm file:text-black hover:file:border-madael-red"
          />
          <p className="text-xs text-[#9A9A9A] mt-1.5">{FREELANCER_CV_LABEL_JENIS}, maksimal 4MB.</p>
        </div>

        {formError && (
          <p role="alert" className="text-sm text-madael-red border-l-4 border-madael-red bg-[#FFF5F5] px-3 py-2">
            {formError}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="bg-madael-red text-white px-8 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60"
          >
            {submitting ? 'Menyimpan...' : 'Simpan & Kirim Undangan'}
          </button>
          <Link
            href={FREELANCER_ADMIN_BASE}
            className="border border-[#E0E0E0] text-black px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:border-madael-red hover:text-madael-red transition-colors"
          >
            Batal
          </Link>
        </div>
      </form>
    </div>
  );
}
