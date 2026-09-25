'use client';

// Widget "Absen Cepat" di Dashboard Saya: karyawan bisa clock in/out langsung
// dari dashboard, tanpa pindah ke halaman /employee/absensi. Logic clock
// in/out (kamera, deteksi wajah, lokasi, layar review) dipakai bersama dari
// lib/useAttendanceClock.js — SAMA PERSIS dengan yang dipakai halaman
// Absensi, supaya validasi (radius geofence, verifikasi wajah) tidak pernah
// beda antara dua tempat ini.
//
// Widget ini sengaja ringkas: cuma status hari ini + tombol aksi. Riwayat
// bulanan, jadwal, pengajuan koreksi, dsb tetap cuma ada di halaman Absensi
// — link "Lihat detail" di bawah mengarah ke sana.

import { useEffect } from 'react';
import Link from 'next/link';
import { Camera, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { useAttendanceClock } from '@/lib/useAttendanceClock';
import CameraCapture from '@/components/CameraCapture';
import AttendanceReviewScreen from '@/components/AttendanceReviewScreen';
import AttendanceStatusBadge from '@/components/AttendanceStatusBadge';

function formatWaktu(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export default function QuickClockInCard({ employee }) {
  const {
    loading, loadError, todayRow, hasReferensiWajah,
    acting, geoError, lastMode, cameraMode,
    review, reviewConfirming, reviewError, reviewFatal,
    reload,
    openCamera, closeCamera, handleCameraCapture, handleConfirmReview, closeReview, handleRetakeFromReview,
  } = useAttendanceClock(employee);

  // Beda dengan halaman Absensi (yang men-trigger loadClockData lewat effect
  // di page-nya sendiri), widget ini harus memicu load-nya sendiri saat
  // pertama kali dipasang di dashboard.
  useEffect(() => {
    if (employee) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.id]);

  return (
    <div className="bg-white border border-[#E0E0E0] p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="text-xs font-semibold text-black tracking-[0.02em]">Absen Cepat</p>
        <Link href="/employee/absensi" className="text-xs text-madael-red hover:text-madael-dark font-medium">
          Lihat detail
        </Link>
      </div>

      {loading && <p className="text-xs text-[#9A9A9A]">Memuat status absensi...</p>}

      {!loading && loadError && (
        <p className="text-xs text-red-600" role="alert">{loadError}</p>
      )}

      {!loading && !loadError && (
        <>
          {!hasReferensiWajah && (
            <p className="flex items-start gap-1.5 text-xs text-[#6B6B6B] mb-3">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              Foto wajah referensi belum didaftarkan — absensi belum bisa diverifikasi otomatis.
            </p>
          )}

          {geoError && (
            <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 mb-3">
              <span className="flex items-start gap-2">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {geoError}
              </span>
              {lastMode && (
                <button onClick={() => openCamera(lastMode)} className="shrink-0 underline font-medium hover:text-red-900">
                  Coba Lagi
                </button>
              )}
            </div>
          )}

          {!todayRow ? (
            <>
              <p className="text-sm text-black mb-3">Kamu belum clock in hari ini.</p>
              <button
                onClick={() => openCamera('in')}
                disabled={acting}
                className="flex items-center gap-2 bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
              >
                <Camera size={15} />
                {acting ? 'Memproses...' : 'Clock In'}
              </button>
            </>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 flex-wrap text-sm text-black">
                <CheckCircle2 size={15} className="text-madael-red" />
                Clock in pukul {formatWaktu(todayRow.clock_in)}
                {todayRow.status_telat && <AttendanceStatusBadge row={todayRow} />}
              </div>

              {!todayRow.clock_out ? (
                <button
                  onClick={() => openCamera('out')}
                  disabled={acting}
                  className="flex items-center gap-2 bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
                >
                  <Camera size={15} />
                  {acting ? 'Memproses...' : 'Clock Out'}
                </button>
              ) : (
                <div className="flex items-center gap-2 text-sm text-black">
                  <Clock size={15} className="text-[#9A9A9A]" />
                  Clock out pukul {formatWaktu(todayRow.clock_out)} — absensi hari ini selesai.
                </div>
              )}
            </div>
          )}
        </>
      )}

      <CameraCapture
        open={!!cameraMode}
        title={`Foto ${cameraMode === 'in' ? 'Clock In' : 'Clock Out'}`}
        hint="Pastikan wajah kamu terlihat jelas di kamera sebelum ambil foto."
        confirmLabel={`Ambil Foto & ${cameraMode === 'in' ? 'Clock In' : 'Clock Out'}`}
        processingLabel="Memproses..."
        processing={acting}
        onCapture={handleCameraCapture}
        onClose={closeCamera}
      />

      <AttendanceReviewScreen
        review={review}
        confirming={reviewConfirming}
        error={reviewError}
        fatal={reviewFatal}
        onConfirm={handleConfirmReview}
        onCancel={closeReview}
        onRetake={handleRetakeFromReview}
      />
    </div>
  );
}