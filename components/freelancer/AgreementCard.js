'use client';

import { useState } from 'react';
import { friendlyCaught } from '@/lib/errorMessage';
import { FREELANCER_CV_MIME, FREELANCER_CV_LABEL_JENIS } from '@/lib/freelancerAdminConfig';
import { AGREEMENT_STATUS } from '@/lib/freelancerAgreementConfig';
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL, PESAN_UKURAN_UPLOAD, readUploadJson } from '@/lib/uploadLimits';
import AgreementStatusBadge from '@/components/freelancer-admin/AgreementStatusBadge';
import ConfirmDialog from '@/components/ConfirmDialog';

const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';
const linkClass = 'text-madael-red hover:underline underline-offset-2';

const API_URL = '/api/freelancer/me/agreement';

// Petunjuk dari sudut pandang Freelancer. Aturan transisinya dipegang server;
// teks di sini hanya mengikuti aturan yang sama (lib/freelancerAgreementConfig.js).
const PETUNJUK_AGREEMENT = {
  [AGREEMENT_STATUS.BELUM_TERSEDIA]:
    'Dokumen Agreement kamu belum tersedia. Silakan hubungi Tim Internal Madael.',
  [AGREEMENT_STATUS.MENUNGGU_TANDA_TANGAN]:
    'Buka dokumen Agreement di bawah, tanda tangani, lalu unggah kembali dokumen yang sudah ditandatangani.',
  [AGREEMENT_STATUS.MENUNGGU_VERIFIKASI]:
    'Dokumen bertanda tangan kamu sudah diunggah dan sedang menunggu verifikasi Tim Internal.',
  [AGREEMENT_STATUS.TERVERIFIKASI]: 'Agreement kamu sudah terverifikasi.',
  [AGREEMENT_STATUS.DITOLAK]:
    'Dokumen bertanda tangan kamu ditolak. Perbaiki sesuai alasan di bawah, lalu unggah ulang.',
};

function formatWaktu(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Bagian "Agreement" di Profil Saya (sisi Freelancer): status, buka dokumen asli,
// unggah/unggah ulang dokumen bertanda tangan, alasan bila ditolak.
// API: /api/freelancer/me/agreement (FRE-TOOL-04). Tombol unggah mengikuti
// `agreement.can_upload_signed` dari server; server tetap penjaga status.
// Dokumen bertanda tangan milik sendiri belum dapat dibuka dari sini (belum ada di
// API; keputusan Kamis perlu dikonfirmasi), jadi tidak ada tautannya.
//
// Props: agreement (bentuk respons API), onChange(agreement) saat unggah berhasil,
// onRefresh() memuat ulang diam-diam setelah unggah gagal (mis. status berubah),
// onToast({ type, message }).
export default function AgreementCard({ agreement, onChange, onRefresh, onToast }) {
  const [pendingFile, setPendingFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [inputKey, setInputKey] = useState(0);

  const status = agreement.status || AGREEMENT_STATUS.BELUM_TERSEDIA;
  const waktuUnggah = agreement.has_signed ? formatWaktu(agreement.uploaded_at) : null;
  const sudahDiputuskan = status === AGREEMENT_STATUS.TERVERIFIKASI || status === AGREEMENT_STATUS.DITOLAK;
  const waktuKeputusan = sudahDiputuskan ? formatWaktu(agreement.verified_at) : null;

  const resetInput = () => setInputKey((k) => k + 1);

  const handlePick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!FREELANCER_CV_MIME[file.type]) {
      onToast({ type: 'error', message: `Format dokumen Agreement harus ${FREELANCER_CV_LABEL_JENIS}.` });
      resetInput();
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      onToast({ type: 'error', message: PESAN_UKURAN_UPLOAD });
      resetInput();
      return;
    }
    // Konfirmasi dulu: setelah diunggah, Freelancer tidak bisa mengganti dokumen
    // sampai Tim memutuskan, jadi salah pilih file tidak boleh langsung terkirim.
    setPendingFile(file);
  };

  const batalUnggah = () => {
    setPendingFile(null);
    resetInput();
  };

  const kirim = async () => {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', pendingFile);
      const res = await fetch(API_URL, { method: 'POST', body: fd });
      const body = await readUploadJson(res, 'Gagal mengupload dokumen Agreement.');
      onChange(body.agreement);
      onToast({ type: 'success', message: 'Dokumen bertanda tangan berhasil diunggah dan menunggu verifikasi Tim Internal.' });
    } catch (err) {
      onToast({
        type: 'error',
        message: friendlyCaught(err, 'Gagal mengupload dokumen Agreement.', { context: 'Unggah Agreement Saya' }),
      });
      await onRefresh();
    }
    setUploading(false);
    setPendingFile(null);
    resetInput();
  };

  return (
    <div>
      <ConfirmDialog
        open={pendingFile !== null}
        title="Unggah Dokumen Bertanda Tangan"
        message={
          <>
            Unggah <strong>{pendingFile?.name}</strong> sebagai dokumen Agreement bertanda tangan? Setelah diunggah,
            dokumen tidak dapat diganti sampai Tim Internal memverifikasi atau menolaknya.
          </>
        }
        confirmLabel="Ya, Unggah"
        busyLabel="Mengunggah..."
        busy={uploading}
        onConfirm={kirim}
        onCancel={batalUnggah}
      />

      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-[#6B6B6B]">{PETUNJUK_AGREEMENT[status]}</p>
        <AgreementStatusBadge status={status} />
      </div>

      {status === AGREEMENT_STATUS.DITOLAK && agreement.rejection_reason && (
        <p className="text-sm text-black border-l-4 border-madael-red bg-[#FFF5F5] px-3 py-2 mt-3">
          <span className="font-medium">Alasan penolakan:</span> {agreement.rejection_reason}
        </p>
      )}

      {agreement.has_original && (
        <p className="text-sm mt-4">
          <a href={`${API_URL}/asli`} target="_blank" rel="noopener noreferrer" className={linkClass}>
            Buka dokumen Agreement
          </a>
        </p>
      )}

      {(waktuUnggah || waktuKeputusan) && (
        <p className="text-xs text-[#9A9A9A] mt-3">
          {waktuUnggah && <>Terakhir diunggah: {waktuUnggah}</>}
          {waktuUnggah && waktuKeputusan && ' · '}
          {waktuKeputusan && (
            <>
              {status === AGREEMENT_STATUS.TERVERIFIKASI ? 'Diverifikasi' : 'Ditolak'}: {waktuKeputusan}
            </>
          )}
        </p>
      )}

      {agreement.can_upload_signed && (
        <div className="mt-5">
          <label htmlFor="fl-agreement-signed" className={labelClass}>
            {status === AGREEMENT_STATUS.DITOLAK ? 'Unggah ulang dokumen bertanda tangan' : 'Unggah dokumen bertanda tangan'}
          </label>
          <input
            key={inputKey}
            id="fl-agreement-signed"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            disabled={uploading}
            onChange={handlePick}
            className="block w-full text-sm text-[#6B6B6B] file:mr-3 file:border file:border-[#E0E0E0] file:bg-white file:px-4 file:py-2 file:text-sm file:text-black hover:file:border-madael-red disabled:opacity-60"
          />
          <p className="text-xs text-[#9A9A9A] mt-1.5">
            {FREELANCER_CV_LABEL_JENIS}, maksimal {UPLOAD_MAX_LABEL}.
          </p>
        </div>
      )}
    </div>
  );
}
