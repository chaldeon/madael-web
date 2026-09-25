'use client';

// Hook bersama untuk alur clock in/out karyawan: muat status hari ini, buka
// kamera, deteksi wajah, ambil lokasi, lalu simpan (lewat layar review kalau
// preferensi konfirmasi tidak dilewati).
//
// Diekstrak dari app/employee/absensi/page.js supaya bisa dipakai ulang PERSIS
// SAMA di widget "Absen Cepat" pada dashboard (components/QuickClockInCard.js)
// — jangan duplikasi handler-handler ini di tempat lain. Semua validasi
// (radius geofence, verifikasi wajah) tetap dihitung server-side di
// app/api/attendance/clock/* — hook ini cuma orkestrasi di sisi client.
//
// employee: { id, ... } — wajib. onRowChange: dipanggil setiap todayRow
// berubah (opsional), dipakai halaman Absensi untuk sinkronkan tabel riwayat
// bulanan; widget dashboard boleh tidak memakainya sama sekali.

import { useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { getFaceDescriptor } from '@/lib/faceVerification';
import { toDateStr } from '@/lib/attendanceSummary';

function todayStr() {
  return toDateStr(new Date());
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateStr(d);
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Browser ini tidak mendukung deteksi lokasi.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
    });
  });
}

export function useAttendanceClock(employee, { onRowChange } = {}) {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [schedule, setSchedule] = useState(null);
  const [todayRow, setTodayRowState] = useState(null);
  const [forgotClockOut, setForgotClockOut] = useState(null);
  const [hasReferensiWajah, setHasReferensiWajah] = useState(false);
  const [workLocations, setWorkLocations] = useState([]);
  const [assignedLocationIds, setAssignedLocationIds] = useState([]);

  const [skipKonfirmasi, setSkipKonfirmasi] = useState(false);
  const [acting, setActing] = useState(false);
  const [geoError, setGeoError] = useState(null);
  const [lastMode, setLastMode] = useState(null);
  const [cameraMode, setCameraMode] = useState(null); // 'in' | 'out' | null

  // review = { mode, blob, photoUrl, preview, token, expiresAt, fotoPath } | null
  const [review, setReview] = useState(null);
  const [reviewConfirming, setReviewConfirming] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const [reviewFatal, setReviewFatal] = useState(false);

  const setTodayRow = useCallback(
    (row) => {
      setTodayRowState(row);
      onRowChange?.(row);
    },
    [onRowChange]
  );

  const load = useCallback(async () => {
    if (!employee) return;
    setLoading(true);
    setLoadError(null);

    const [schedRes, todayRes, yesterdayRes, refRes, locRes, assignedLocRes, prefRes] = await Promise.all([
      supabase.from('work_schedule').select('*').eq('employee_id', employee.id).maybeSingle(),
      supabase.from('attendance').select('*').eq('employee_id', employee.id).eq('tanggal', todayStr()).maybeSingle(),
      supabase.from('attendance').select('*').eq('employee_id', employee.id).eq('tanggal', yesterdayStr()).maybeSingle(),
      // Hanya butuh tahu ADA/TIDAKNYA foto referensi, bukan descriptor mentahnya.
      supabase.from('employees').select('foto_referensi_url').eq('id', employee.id).maybeSingle(),
      // CUMA buat tampilan "lokasi kamu di-lock ke mana" — geofence tetap
      // dihitung server-side, lihat catatan startReview/handleCameraCapture.
      supabase.from('work_locations').select('*').eq('aktif', true),
      supabase.from('employee_work_locations').select('work_location_id').eq('employee_id', employee.id),
      fetch('/api/attendance/preferences')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    const firstError = schedRes.error || todayRes.error || yesterdayRes.error;
    if (firstError) {
      setLoadError(firstError.message || 'Gagal memuat data absensi. Periksa koneksi internet kamu.');
      setLoading(false);
      return;
    }

    setSchedule(schedRes.data || null);
    setTodayRow(todayRes.data || null);
    const yRow = yesterdayRes.data || null;
    setForgotClockOut(yRow && yRow.clock_in && !yRow.clock_out ? yRow : null);
    setHasReferensiWajah(!refRes.error && !!refRes.data?.foto_referensi_url);
    setSkipKonfirmasi(prefRes?.lewati === true);
    setWorkLocations(locRes.error ? [] : locRes.data || []);
    setAssignedLocationIds(assignedLocRes.error ? [] : (assignedLocRes.data || []).map((r) => r.work_location_id));
    setLoading(false);
  }, [supabase, employee, setTodayRow]);

  const openCamera = (mode) => {
    setGeoError(null);
    setLastMode(mode);
    setCameraMode(mode);
  };

  const closeCamera = () => setCameraMode(null);

  const uploadFoto = async (blob, mode) => {
    const path = `${employee.id}/${todayStr()}-${mode}-${Date.now()}.jpg`;
    const { error } = await supabase.storage.from('attendance-photos').upload(path, blob, {
      contentType: 'image/jpeg',
    });
    if (error) throw error;
    return path;
  };

  const closeReview = () => {
    if (review?.photoUrl) URL.revokeObjectURL(review.photoUrl);
    setReview(null);
    setReviewError(null);
    setReviewFatal(false);
    setReviewConfirming(false);
  };

  // Minta server menghitung ringkasan (TIDAK menyimpan), lalu tampilkan layar review.
  const startReview = async (mode, blob, descriptor) => {
    try {
      const pos = await getPosition();
      const res = await fetch('/api/attendance/clock/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          descriptor,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menyiapkan ringkasan absensi.');

      setReviewError(null);
      setReviewFatal(false);
      setReviewConfirming(false);
      setReview({
        mode,
        blob,
        photoUrl: URL.createObjectURL(blob),
        preview: json.preview,
        token: json.token,
        expiresAt: json.expiresAt,
        fotoPath: null,
      });
    } catch (err) {
      setGeoError(err.message || 'Gagal mengambil lokasi. Pastikan izin lokasi diaktifkan.');
    } finally {
      setActing(false);
    }
  };

  const handleRetakeFromReview = () => {
    const mode = review?.mode;
    closeReview();
    if (mode) openCamera(mode);
  };

  // Simpan hasil yang sudah dihitung server saat preview (token bertanda tangan):
  // jam yang tercatat = jam saat foto diambil, bukan jam tombol ini ditekan.
  const handleConfirmReview = async () => {
    if (!review || reviewConfirming) return;
    setReviewConfirming(true);
    setReviewError(null);
    try {
      let fotoPath = review.fotoPath;
      if (!fotoPath) {
        try {
          fotoPath = await uploadFoto(review.blob, review.mode);
          setReview((r) => (r ? { ...r, fotoPath } : r));
        } catch (err) {
          setGeoError('Foto gagal disimpan, tapi absen tetap diproses. (' + (err.message || 'error kamera') + ')');
        }
      }

      const res = await fetch('/api/attendance/clock/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: review.token, fotoPath: fotoPath || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReviewFatal(!!json.fatal);
        setReviewError(json.error || 'Gagal menyimpan absensi.');
        return;
      }

      setTodayRow(json.data);
      closeReview();
    } catch {
      setReviewError('Gagal menyimpan absensi. Periksa koneksi internet kamu lalu coba lagi.');
    } finally {
      setReviewConfirming(false);
    }
  };

  const handleCameraCapture = async (blob, videoEl) => {
    const mode = cameraMode;
    setCameraMode(null); // tutup modal dulu, sisanya diproses di background
    setActing(true);
    setGeoError(null);

    let descriptor;
    try {
      descriptor = await getFaceDescriptor(videoEl);
    } catch (err) {
      console.error('Deteksi wajah gagal diproses:', err);
    }

    if (!skipKonfirmasi) {
      await startReview(mode, blob, descriptor);
      return;
    }

    // ---- Jalur simpan langsung (layar konfirmasi dilewati) ----
    let fotoPath = null;
    try {
      fotoPath = await uploadFoto(blob, mode);
    } catch (err) {
      setGeoError('Foto gagal disimpan, tapi absen tetap diproses. (' + (err.message || 'error kamera') + ')');
    }

    try {
      const pos = await getPosition();
      const res = await fetch('/api/attendance/clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          fotoPath,
          descriptor,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan absensi.');

      setTodayRow(json.data);
    } catch (err) {
      setGeoError(err.message || 'Gagal mengambil lokasi. Pastikan izin lokasi diaktifkan.');
    } finally {
      setActing(false);
    }
  };

  const lockedLocations = workLocations.filter((l) => assignedLocationIds.includes(l.id));

  return {
    // status
    loading, loadError,
    schedule, todayRow, forgotClockOut, hasReferensiWajah, lockedLocations,
    skipKonfirmasi, acting, geoError, lastMode, cameraMode,
    review, reviewConfirming, reviewError, reviewFatal,
    // actions
    reload: load,
    setTodayRow,
    openCamera, closeCamera,
    handleCameraCapture,
    handleConfirmReview, closeReview, handleRetakeFromReview,
  };
}