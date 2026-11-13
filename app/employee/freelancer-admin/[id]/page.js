'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { callJsonApi } from '@/lib/apiClient';
import { friendlyCaught } from '@/lib/errorMessage';
import {
  FREELANCER_ADMIN_BASE,
  FREELANCER_CV_MIME,
  FREELANCER_CV_LABEL_JENIS,
  validateFreelancerInput,
} from '@/lib/freelancerAdminConfig';
import { FREELANCER_STATUS, FREELANCER_STATUS_OPTIONS, freelancerStatusLabel } from '@/lib/freelancerModules';
import { UPLOAD_MAX_BYTES, PESAN_UKURAN_UPLOAD, readUploadJson } from '@/lib/uploadLimits';
import FreelancerForm from '@/components/freelancer-admin/FreelancerForm';
import FreelancerStatusBadge from '@/components/freelancer-admin/FreelancerStatusBadge';
import ConfirmDialog from '@/components/ConfirmDialog';
import ErrorState from '@/components/ErrorState';
import LoadingState from '@/components/LoadingState';
import Toast from '@/components/employee-list/Toast';

const selectClass =
  'w-full border border-[#E0E0E0] px-4 py-2.5 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors disabled:opacity-60';
const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';

// Bentuk isian form dari data server (nilai null -> string kosong).
function formDariData(f) {
  return {
    nama_lengkap: f.nama_lengkap || '',
    email: f.email || '',
    no_whatsapp: f.no_whatsapp || '',
    alamat: f.alamat || '',
    tanggal_bergabung: f.tanggal_bergabung || '',
  };
}

export default function DetailFreelancerPage() {
  const { id } = useParams();

  const [reloadTick, setReloadTick] = useState(0);
  // `key` = id|reloadTick milik data yang sudah dimuat; loading diturunkan dari
  // perbedaannya (tanpa setState sinkron di effect).
  const [loaded, setLoaded] = useState({ key: null, freelancer: null, error: null });
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirmStatus, setConfirmStatus] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [cvInputKey, setCvInputKey] = useState(0);

  const requestKey = `${id}|${reloadTick}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await callJsonApi(`/api/freelancers/${id}`, 'GET');
      if (cancelled) return;
      if (!res.ok) {
        setLoaded({ key: requestKey, freelancer: null, error: res.error });
        return;
      }
      setLoaded({ key: requestKey, freelancer: res.data.freelancer, error: null });
      setForm(formDariData(res.data.freelancer));
      setStatus(res.data.freelancer.status);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, requestKey]);

  const loading = loaded.key !== requestKey;
  const { freelancer, error } = loaded;

  const handleChange = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const dataBerubah =
    !!freelancer &&
    !!form &&
    (form.nama_lengkap.trim().replace(/\s+/g, ' ') !== (freelancer.nama_lengkap || '') ||
      form.no_whatsapp.trim() !== (freelancer.no_whatsapp || '') ||
      form.alamat.trim() !== (freelancer.alamat || '') ||
      form.tanggal_bergabung !== (freelancer.tanggal_bergabung || ''));
  const statusBerubah = !!freelancer && status !== freelancer.status;
  const adaPerubahan = dataBerubah || statusBerubah;

  const simpan = async () => {
    setSaving(true);
    const res = await callJsonApi(`/api/freelancers/${id}`, 'PATCH', { ...form, status });
    setSaving(false);
    setConfirmStatus(false);
    if (!res.ok) {
      setFormError(res.error);
      return;
    }
    setLoaded((prev) => ({ ...prev, freelancer: res.data.freelancer }));
    setForm(formDariData(res.data.freelancer));
    setStatus(res.data.freelancer.status);
    setFormError(null);
    if (res.data.warning) {
      setToast({ type: 'error', message: res.data.warning });
    } else {
      setToast({ type: 'success', message: 'Perubahan tersimpan.' });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (saving || !adaPerubahan) return;
    setFormError(null);

    const { error: validationError } = validateFreelancerInput(form, { mode: 'update' });
    if (validationError) {
      setFormError(validationError);
      return;
    }

    // Menonaktifkan/menangguhkan memblokir login Freelancer: minta konfirmasi.
    if (statusBerubah && status !== FREELANCER_STATUS.ACTIVE) {
      setConfirmStatus(true);
      return;
    }
    simpan();
  };

  const handleCvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!FREELANCER_CV_MIME[file.type]) {
      setToast({ type: 'error', message: `Format CV harus ${FREELANCER_CV_LABEL_JENIS}.` });
      setCvInputKey((k) => k + 1);
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setToast({ type: 'error', message: PESAN_UKURAN_UPLOAD });
      setCvInputKey((k) => k + 1);
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/freelancers/${id}/cv`, { method: 'POST', body: fd });
      await readUploadJson(res, 'Gagal mengupload CV.');
      setLoaded((prev) => ({ ...prev, freelancer: { ...prev.freelancer, has_cv: true } }));
      setToast({ type: 'success', message: 'CV berhasil diunggah.' });
    } catch (err) {
      setToast({ type: 'error', message: friendlyCaught(err, 'Gagal mengupload CV.', { context: 'Upload CV Freelancer' }) });
    }
    setUploading(false);
    setCvInputKey((k) => k + 1);
  };

  if (loading) {
    return (
      <div className="max-w-[640px] mx-auto px-6 py-10">
        <LoadingState label="Memuat data Freelancer..." />
      </div>
    );
  }

  if (error || !freelancer || !form) {
    return (
      <div className="max-w-[640px] mx-auto px-6 py-10">
        <Link href={FREELANCER_ADMIN_BASE} className="text-sm text-[#6B6B6B] hover:text-black">
          ← Daftar Freelancer
        </Link>
        <div className="mt-4">
          <ErrorState message={error || 'Data Freelancer tidak ditemukan.'} onRetry={() => setReloadTick((t) => t + 1)} />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[640px] mx-auto px-6 py-10">
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <ConfirmDialog
        open={confirmStatus}
        title={`Ubah status ke ${freelancerStatusLabel(status)}`}
        message={
          <>
            <strong>{freelancer.nama_lengkap}</strong> tidak akan bisa login maupun memakai fitur dashboard
            Freelancer selama berstatus {freelancerStatusLabel(status)}. Akun dan datanya tidak dihapus, dan
            statusnya bisa dikembalikan ke Active kapan saja.
          </>
        }
        confirmLabel="Ya, Ubah Status"
        busy={saving}
        onConfirm={simpan}
        onCancel={() => setConfirmStatus(false)}
      />

      <Link href={FREELANCER_ADMIN_BASE} className="text-sm text-[#6B6B6B] hover:text-black">
        ← Daftar Freelancer
      </Link>

      <div className="flex items-start justify-between gap-4 mt-3 mb-8">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">
            {freelancer.nama_lengkap}
          </h1>
          <p className="text-sm text-[#6B6B6B] mt-1">{freelancer.freelancer_code}</p>
        </div>
        <FreelancerStatusBadge status={freelancer.status} />
      </div>

      {!freelancer.has_account && (
        <p className="text-sm text-black border-l-4 border-madael-red bg-[#FFF5F5] px-3 py-2 mb-6">
          Data ini belum terhubung ke akun login, jadi Freelancer belum bisa masuk dan perubahan status tidak
          memblokir/membuka login. Hubungi pengembang.
        </p>
      )}

      <form onSubmit={handleSubmit} className="bg-white border border-[#E0E0E0] p-6 space-y-4" noValidate>
        <FreelancerForm form={form} onChange={handleChange} emailLocked disabled={saving} />

        <div>
          <label htmlFor="fl-status" className={labelClass}>Status Akun</label>
          <select
            id="fl-status"
            value={status}
            disabled={saving}
            onChange={(e) => setStatus(e.target.value)}
            className={selectClass}
          >
            {FREELANCER_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="text-xs text-[#9A9A9A] mt-1.5">
            Inactive dan Suspended: Freelancer tidak bisa login atau memakai fitur dashboard, dan link
            referralnya berhenti dihitung. Akun dan data tidak dihapus.
          </p>
        </div>

        {formError && (
          <p role="alert" className="text-sm text-madael-red border-l-4 border-madael-red bg-[#FFF5F5] px-3 py-2">
            {formError}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || !adaPerubahan}
            className="bg-madael-red text-white px-8 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
          >
            {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </div>
      </form>

      <div className="bg-white border border-[#E0E0E0] p-6 mt-6">
        <h2 className="text-sm font-medium text-black mb-1">CV</h2>
        <p className="text-sm text-[#6B6B6B] mb-4">
          {freelancer.has_cv ? (
            <a
              href={`/api/freelancers/${id}/cv`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-madael-red hover:underline underline-offset-2"
            >
              Lihat CV
            </a>
          ) : (
            'CV belum diunggah.'
          )}
        </p>
        <label htmlFor="fl-cv" className={labelClass}>
          {freelancer.has_cv ? 'Ganti CV' : 'Unggah CV'}
        </label>
        <input
          key={cvInputKey}
          id="fl-cv"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          disabled={uploading}
          onChange={handleCvUpload}
          className="block w-full text-sm text-[#6B6B6B] file:mr-3 file:border file:border-[#E0E0E0] file:bg-white file:px-4 file:py-2 file:text-sm file:text-black hover:file:border-madael-red disabled:opacity-60"
        />
        <p className="text-xs text-[#9A9A9A] mt-1.5">
          {uploading ? 'Mengunggah...' : `${FREELANCER_CV_LABEL_JENIS}, maksimal 4MB. CV lama tetap tersimpan di Drive.`}
        </p>
      </div>
    </div>
  );
}
