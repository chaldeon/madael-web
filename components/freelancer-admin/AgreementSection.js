'use client';

import { useEffect, useState } from 'react';
import { callJsonApi } from '@/lib/apiClient';
import { friendlyCaught } from '@/lib/errorMessage';
import { FREELANCER_CV_MIME, FREELANCER_CV_LABEL_JENIS } from '@/lib/freelancerAdminConfig';
import {
  AGREEMENT_ALASAN_MAX,
  AGREEMENT_STATUS,
  bolehDiputuskan,
  bolehGantiDokumenAsli,
} from '@/lib/freelancerAgreementConfig';
import { UPLOAD_MAX_BYTES, PESAN_UKURAN_UPLOAD, readUploadJson } from '@/lib/uploadLimits';
import AgreementStatusBadge from '@/components/freelancer-admin/AgreementStatusBadge';
import ConfirmDialog from '@/components/ConfirmDialog';
import ErrorState from '@/components/ErrorState';
import LoadingState from '@/components/LoadingState';

const labelClass = 'block text-xs font-medium text-[#3D3D3D] mb-1.5';
const linkClass = 'text-madael-red hover:underline underline-offset-2';

const PETUNJUK = {
  [AGREEMENT_STATUS.BELUM_TERSEDIA]:
    'Agreement belum tersedia. Unggah dokumen Agreement agar Freelancer dapat menandatanganinya.',
  [AGREEMENT_STATUS.MENUNGGU_TANDA_TANGAN]:
    'Menunggu Freelancer mengunggah dokumen yang sudah ditandatangani.',
  [AGREEMENT_STATUS.MENUNGGU_VERIFIKASI]:
    'Freelancer sudah mengunggah dokumen bertanda tangan. Periksa dokumennya, lalu verifikasi atau tolak.',
  [AGREEMENT_STATUS.TERVERIFIKASI]: 'Agreement sudah terverifikasi.',
  [AGREEMENT_STATUS.DITOLAK]: 'Dokumen bertanda tangan ditolak. Freelancer dapat mengunggah ulang.',
};

function formatWaktu(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Bagian "Agreement" di halaman detail Freelancer (admin): status, unggah/ganti
// dokumen asli, buka dokumen asli dan bertanda tangan, verifikasi/tolak.
// API: /api/freelancers/[id]/agreement (FRE-TOOL-02). Aturan transisi status
// dipegang server; tombol di sini hanya mengikuti aturan yang sama
// (lib/freelancerAgreementConfig.js) dan server tetap menjadi penjaga.
// Props: id (UUID Freelancer), nama (untuk teks dialog), onToast({ type, message }).
export default function AgreementSection({ id, nama, onToast }) {
  const [reloadTick, setReloadTick] = useState(0);
  // Pola sama dengan halaman detail: loading diturunkan dari key, bukan setState
  // sinkron di effect.
  const [loaded, setLoaded] = useState({ key: null, agreement: null, error: null });
  const [uploading, setUploading] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const [dialog, setDialog] = useState(null); // 'verifikasi' | 'tolak' | null
  const [alasan, setAlasan] = useState('');
  const [dialogError, setDialogError] = useState(null);
  const [busy, setBusy] = useState(false);

  const apiUrl = `/api/freelancers/${id}/agreement`;
  const requestKey = `${id}|${reloadTick}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await callJsonApi(apiUrl, 'GET');
      if (cancelled) return;
      if (!res.ok) {
        setLoaded({ key: requestKey, agreement: null, error: res.error });
        return;
      }
      setLoaded({ key: requestKey, agreement: res.data.agreement, error: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, requestKey]);

  const loading = loaded.key !== requestKey;
  const { agreement, error } = loaded;
  const status = agreement?.status || AGREEMENT_STATUS.BELUM_TERSEDIA;

  // Muat ulang diam-diam (tanpa layar loading), dipakai setelah aksi gagal karena
  // status baru saja berubah (409) supaya tombol kembali sesuai keadaan terbaru.
  const segarkan = async () => {
    const res = await callJsonApi(apiUrl, 'GET');
    if (res.ok) setLoaded((prev) => ({ ...prev, agreement: res.data.agreement, error: null }));
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!FREELANCER_CV_MIME[file.type]) {
      onToast({ type: 'error', message: `Format dokumen Agreement harus ${FREELANCER_CV_LABEL_JENIS}.` });
      setInputKey((k) => k + 1);
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      onToast({ type: 'error', message: PESAN_UKURAN_UPLOAD });
      setInputKey((k) => k + 1);
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(apiUrl, { method: 'POST', body: fd });
      const body = await readUploadJson(res, 'Gagal mengupload dokumen Agreement.');
      setLoaded((prev) => ({ ...prev, agreement: body.agreement, error: null }));
      onToast({ type: 'success', message: 'Dokumen Agreement berhasil diunggah.' });
    } catch (err) {
      onToast({
        type: 'error',
        message: friendlyCaught(err, 'Gagal mengupload dokumen Agreement.', { context: 'Upload Agreement Freelancer' }),
      });
      await segarkan();
    }
    setUploading(false);
    setInputKey((k) => k + 1);
  };

  const tutupDialog = () => {
    setDialog(null);
    setAlasan('');
    setDialogError(null);
  };

  const kirimKeputusan = async () => {
    const ditolak = dialog === 'tolak';
    const teksAlasan = alasan.trim();
    if (ditolak && !teksAlasan) {
      setDialogError('Alasan penolakan wajib diisi.');
      return;
    }
    setBusy(true);
    setDialogError(null);
    const res = await callJsonApi(
      apiUrl,
      'PATCH',
      ditolak
        ? { keputusan: AGREEMENT_STATUS.DITOLAK, alasan: teksAlasan }
        : { keputusan: AGREEMENT_STATUS.TERVERIFIKASI }
    );
    setBusy(false);

    if (res.ok) {
      setLoaded((prev) => ({ ...prev, agreement: res.data.agreement, error: null }));
      tutupDialog();
      onToast({ type: 'success', message: ditolak ? 'Agreement ditolak.' : 'Agreement terverifikasi.' });
      return;
    }
    // 409 = status sudah berubah (mis. Tim lain sudah memutuskan): tutup dialog,
    // tampilkan alasannya, dan segarkan status. Error lain: dialog tetap terbuka
    // (alasan yang sudah diketik tidak hilang) dengan pesan di dalamnya.
    if (res.status === 409) {
      tutupDialog();
      onToast({ type: 'error', message: res.error });
      await segarkan();
      return;
    }
    setDialogError(res.error);
  };

  const dialogMessage = (
    <>
      {dialog === 'tolak' ? (
        <>
          Tolak dokumen bertanda tangan <strong>{nama}</strong>? Freelancer perlu mengunggah ulang. Tulis alasannya
          di bawah.
        </>
      ) : (
        <>
          Verifikasi Agreement <strong>{nama}</strong>? Setelah terverifikasi, dokumen tidak dapat diganti lagi dan
          keputusan ini tidak bisa dibatalkan dari halaman ini.
        </>
      )}
      {dialogError && <span className="block text-madael-red mt-2">{dialogError}</span>}
    </>
  );

  const waktuUnggah = formatWaktu(agreement?.uploaded_at);
  const waktuKeputusan = formatWaktu(agreement?.verified_at);
  const sudahDiputuskan = status === AGREEMENT_STATUS.TERVERIFIKASI || status === AGREEMENT_STATUS.DITOLAK;

  return (
    <div className="bg-white border border-[#E0E0E0] p-6 mt-6">
      <ConfirmDialog
        open={dialog !== null}
        title={dialog === 'tolak' ? 'Tolak Agreement' : 'Verifikasi Agreement'}
        message={dialogMessage}
        confirmLabel={dialog === 'tolak' ? 'Ya, Tolak' : 'Ya, Verifikasi'}
        busy={busy}
        onConfirm={kirimKeputusan}
        onCancel={tutupDialog}
        {...(dialog === 'tolak'
          ? {
              inputLabel: 'Alasan penolakan',
              inputPlaceholder: 'Contoh: tanda tangan tidak terbaca',
              inputMaxLength: AGREEMENT_ALASAN_MAX,
              value: alasan,
              onChange: setAlasan,
            }
          : {})}
      />

      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-medium text-black">Agreement</h2>
        {!loading && !error && <AgreementStatusBadge status={status} />}
      </div>

      {loading ? (
        <div className="[&>div]:py-6">
          <LoadingState label="Memuat Agreement..." />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => setReloadTick((t) => t + 1)} />
      ) : (
        <>
          <p className="text-sm text-[#6B6B6B]">{PETUNJUK[status]}</p>

          {status === AGREEMENT_STATUS.DITOLAK && agreement.rejection_reason && (
            <p className="text-sm text-black border-l-4 border-madael-red bg-[#FFF5F5] px-3 py-2 mt-3">
              <span className="font-medium">Alasan penolakan:</span> {agreement.rejection_reason}
            </p>
          )}

          {(agreement.has_original || agreement.has_signed) && (
            <ul className="text-sm mt-4 space-y-1.5">
              {agreement.has_original && (
                <li>
                  <a href={`${apiUrl}/asli`} target="_blank" rel="noopener noreferrer" className={linkClass}>
                    Lihat dokumen asli
                  </a>
                </li>
              )}
              {agreement.has_signed && (
                <li>
                  <a href={`${apiUrl}/bertanda-tangan`} target="_blank" rel="noopener noreferrer" className={linkClass}>
                    Lihat dokumen bertanda tangan
                  </a>
                </li>
              )}
            </ul>
          )}

          {(waktuUnggah || (sudahDiputuskan && waktuKeputusan)) && (
            <p className="text-xs text-[#9A9A9A] mt-3">
              {waktuUnggah && <>Terakhir diunggah: {waktuUnggah}</>}
              {waktuUnggah && sudahDiputuskan && waktuKeputusan && ' · '}
              {sudahDiputuskan && waktuKeputusan && (
                <>
                  {status === AGREEMENT_STATUS.TERVERIFIKASI ? 'Diverifikasi' : 'Ditolak'}: {waktuKeputusan}
                </>
              )}
            </p>
          )}

          {bolehDiputuskan(status) && (
            <div className="flex gap-3 mt-5">
              <button
                type="button"
                onClick={() => setDialog('verifikasi')}
                className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
              >
                Verifikasi
              </button>
              <button
                type="button"
                onClick={() => setDialog('tolak')}
                className="border border-[#E0E0E0] text-black px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:border-black transition-colors"
              >
                Tolak
              </button>
            </div>
          )}

          {bolehGantiDokumenAsli(status) ? (
            <div className="mt-5">
              <label htmlFor="fl-agreement" className={labelClass}>
                {status === AGREEMENT_STATUS.BELUM_TERSEDIA ? 'Unggah dokumen Agreement' : 'Ganti dokumen asli'}
              </label>
              <input
                key={inputKey}
                id="fl-agreement"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                disabled={uploading}
                onChange={handleUpload}
                className="block w-full text-sm text-[#6B6B6B] file:mr-3 file:border file:border-[#E0E0E0] file:bg-white file:px-4 file:py-2 file:text-sm file:text-black hover:file:border-madael-red disabled:opacity-60"
              />
              <p className="text-xs text-[#9A9A9A] mt-1.5">
                {uploading
                  ? 'Mengunggah...'
                  : `${FREELANCER_CV_LABEL_JENIS}, maksimal 4MB. Dokumen lama tetap tersimpan di Drive.`}
                {!uploading && status === AGREEMENT_STATUS.DITOLAK &&
                  ' Mengganti dokumen asli membuat Freelancer perlu menandatangani ulang.'}
              </p>
            </div>
          ) : (
            <p className="text-xs text-[#9A9A9A] mt-5">
              {status === AGREEMENT_STATUS.TERVERIFIKASI
                ? 'Dokumen tidak dapat diganti setelah terverifikasi.'
                : 'Dokumen asli tidak dapat diganti saat menunggu verifikasi. Tolak lebih dulu bila perlu dokumen baru.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
