'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { MapPin, Clock, CheckCircle2, AlertTriangle, Camera, X, FileEdit, Upload, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { useAttendanceClock } from '@/lib/useAttendanceClock';
import { similarityPercent } from '@/lib/faceVerification';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import CameraCapture from '@/components/CameraCapture';
import AttendanceStatusBadge from '@/components/AttendanceStatusBadge';
import LateReasonBox from '@/components/LateReasonBox';
import AttendanceReviewScreen from '@/components/AttendanceReviewScreen';
import LiveClock from '@/components/LiveClock';
import { summarizeMonth, currentMonthValue, shiftMonth, monthBounds, formatBulan } from '@/lib/attendanceSummary';

const HARI_LABEL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function timeStr(date) {
  return date.toTimeString().slice(0, 8); // HH:MM:SS, dibandingkan sebagai string vs kolom time
}

function formatJam(value) {
  if (!value) return '—';
  return value.slice(0, 5); // HH:MM
}

function formatWaktu(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

export default function AbsensiPage() {
  const supabase = createClient();
  const { status, employee } = useModuleAccess('absensi');

  // Riwayat bulanan (filter bulan). monthData menyimpan bulan asal barisnya
  // supaya tidak pernah dipakai untuk bulan lain saat pengguna ganti bulan.
  const [monthValue, setMonthValue] = useState(() => currentMonthValue());
  const [monthData, setMonthData] = useState(() => ({ month: currentMonthValue(), rows: [] }));
  const [monthLeaves, setMonthLeaves] = useState([]); // cuti approved yang beririsan dengan bulan terpilih
  const [monthLoading, setMonthLoading] = useState(true);
  const [monthError, setMonthError] = useState(null);
  const monthReqRef = useRef(0); // abaikan respon lama kalau pengguna keburu ganti bulan

  // Sinkronkan baris hasil clock in/out (atau simpan alasan telat) ke riwayat
  // bulan yang sedang tampil (diabaikan kalau baris itu milik bulan lain).
  // Deps kosong (functional setState) supaya identitasnya stabil antar render
  // — dipakai sebagai onRowChange ke useAttendanceClock di bawah, dan kalau
  // identitasnya berubah tiap render, reload data absensi ikut ter-trigger ulang.
  const syncMonthRow = useCallback((row) => {
    setMonthData((prev) => {
      if (!row?.tanggal || !row.tanggal.startsWith(prev.month)) return prev;
      const rest = prev.rows.filter((r) => r.id !== row.id && r.tanggal !== row.tanggal);
      return { ...prev, rows: [row, ...rest] };
    });
  }, []);

  // Status hari ini + alur clock in/out (kamera, lokasi, review, verifikasi
  // wajah) — logic-nya dipakai bersama dengan widget "Absen Cepat" di
  // dashboard, lihat lib/useAttendanceClock.js.
  const {
    loading, loadError,
    schedule, todayRow, forgotClockOut, hasReferensiWajah, lockedLocations,
    acting, geoError, lastMode, cameraMode,
    review, reviewConfirming, reviewError, reviewFatal,
    reload: loadClockData,
    setTodayRow,
    openCamera, closeCamera, handleCameraCapture, handleConfirmReview, closeReview, handleRetakeFromReview,
  } = useAttendanceClock(employee, { onRowChange: syncMonthRow });

  // --- Pengajuan koreksi absensi mandiri ---
  const [myCorrections, setMyCorrections] = useState([]);
  const [showKoreksiForm, setShowKoreksiForm] = useState(false);
  const [koreksiForm, setKoreksiForm] = useState({ tanggal: todayStr(), jamMasuk: '', jamPulang: '', alasan: '' });
  const [koreksiFoto, setKoreksiFoto] = useState(null);
  // Snapshot form koreksi saat dibuka, supaya bisa dibandingkan ke isinya sekarang.
  const koreksiFormBaselineRef = useRef({ tanggal: todayStr(), jamMasuk: '', jamPulang: '', alasan: '' });
  const handleKoreksiModalBackdrop = useModalDismiss(
    showKoreksiForm,
    () => setShowKoreksiForm(false),
    undefined,
    JSON.stringify(koreksiForm) !== JSON.stringify(koreksiFormBaselineRef.current) || !!koreksiFoto
  );
  const [koreksiSaving, setKoreksiSaving] = useState(false);
  const [koreksiError, setKoreksiError] = useState(null);
  const [cancelingKoreksiId, setCancelingKoreksiId] = useState(null);
  const [koreksiCancelError, setKoreksiCancelError] = useState(null);
  

  // Riwayat pengajuan koreksi absensi mandiri — data khusus halaman ini
  // (bukan bagian dari alur clock in/out bersama di useAttendanceClock).
  const loadCorrections = useCallback(async () => {
    if (!employee) return;
    const { data, error } = await supabase
      .from('attendance_corrections')
      .select('*')
      .eq('requested_by', employee.id)
      .order('created_at', { ascending: false })
      .limit(10);
    if (!error) setMyCorrections(data || []);
  }, [supabase, employee]);

  // Pola fetch-data standar (load saat status akses siap) — linter
  // react-hooks/set-state-in-effect menandai ini sebagai potensi masalah,
  // tapi ini bukan derived-state-in-render, cuma trigger fetch data awal.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (status === 'allowed') {
      loadClockData();
      loadCorrections();
    }
  }, [status, loadClockData, loadCorrections]);

  // Data riwayat untuk bulan terpilih: baris absensi + cuti yang sudah disetujui.
  // Cuti ikut diambil supaya hari cuti tidak salah tampil sebagai "Tanpa Kehadiran".
  const loadMonth = useCallback(async () => {
    if (!employee) return;
    const reqId = ++monthReqRef.current;
    setMonthLoading(true);
    setMonthError(null);

    const { firstDay, lastDay } = monthBounds(monthValue);
    const [attRes, leaveRes] = await Promise.all([
      supabase
        .from('attendance')
        .select('*')
        .eq('employee_id', employee.id)
        .gte('tanggal', firstDay)
        .lte('tanggal', lastDay),
      supabase
        .from('leave_requests')
        .select('tanggal_mulai, tanggal_selesai')
        .eq('employee_id', employee.id)
        .eq('status', 'approved')
        .lte('tanggal_mulai', lastDay)
        .gte('tanggal_selesai', firstDay),
    ]);

    if (reqId !== monthReqRef.current) return; // sudah ada request bulan yang lebih baru

    const firstError = attRes.error || leaveRes.error;
    if (firstError) {
      setMonthError(firstError.message || 'Gagal memuat riwayat absensi. Periksa koneksi internet kamu.');
      setMonthLoading(false);
      return;
    }

    setMonthData({ month: monthValue, rows: attRes.data || [] });
    setMonthLeaves(leaveRes.data || []);
    setMonthLoading(false);
  }, [supabase, employee, monthValue]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (status === 'allowed') loadMonth();
  }, [status, loadMonth]);

  // Perhitungan hari kerja / hadir / telat / tidak hadir dipakai ulang dari
  // lib/attendanceSummary.js (aturan searah dengan Rekap Bulanan admin, dari
  // work_schedule.hari_kerja). null selama data bulan terpilih belum siap.
  const summary = useMemo(() => {
    if (monthLoading || monthError || monthData.month !== monthValue) return null;
    return summarizeMonth({
      monthValue,
      rows: monthData.rows,
      leaves: monthLeaves,
      hariKerja: schedule?.hari_kerja,
      today: todayStr(),
    });
  }, [monthLoading, monthError, monthValue, monthData, monthLeaves, schedule]);

  const openKoreksiForm = () => {
    setKoreksiError(null);
    const initial = { tanggal: todayStr(), jamMasuk: '', jamPulang: '', alasan: '' };
    koreksiFormBaselineRef.current = initial;
    setKoreksiForm(initial);
    setKoreksiFoto(null);
    setShowKoreksiForm(true);
  };

  const handleSubmitKoreksi = async () => {
    setKoreksiError(null);

    if (!koreksiForm.alasan.trim()) {
      setKoreksiError('Alasan koreksi wajib diisi.');
      return;
    }
    if (!koreksiForm.jamMasuk && !koreksiForm.jamPulang) {
      setKoreksiError('Isi minimal salah satu: jam masuk atau jam pulang yang seharusnya.');
      return;
    }
    if (!koreksiFoto) {
      setKoreksiError('Foto bukti wajib diupload (mis. foto absen fisik, selfie di lokasi kerja, dsb).');
      return;
    }

    setKoreksiSaving(true);
    try {
      // 1. Upload foto bukti ke Google Drive (Shared Drive "Absensi")
      const fd = new FormData();
      fd.append('file', koreksiFoto);
      fd.append('tanggal', koreksiForm.tanggal);
      const uploadRes = await fetch('/api/attendance/koreksi-bukti', { method: 'POST', body: fd });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Gagal mengupload foto bukti.');

      // 2. Ambil record attendance existing di tanggal itu (kalau ada) untuk jejak before_*
      const { data: existingRow } = await supabase
        .from('attendance')
        .select('id, clock_in, clock_out, status_telat')
        .eq('employee_id', employee.id)
        .eq('tanggal', koreksiForm.tanggal)
        .maybeSingle();

      const afterClockIn = koreksiForm.jamMasuk
        ? new Date(`${koreksiForm.tanggal}T${koreksiForm.jamMasuk}:00`).toISOString()
        : (existingRow?.clock_in || null);
      const afterClockOut = koreksiForm.jamPulang
        ? new Date(`${koreksiForm.tanggal}T${koreksiForm.jamPulang}:00`).toISOString()
        : (existingRow?.clock_out || null);

      // 3. Insert pengajuan koreksi, status pending menunggu approval superadmin
      const { data: inserted, error: insertError } = await supabase
        .from('attendance_corrections')
        .insert([{
          attendance_id: existingRow?.id || null,
          employee_id: employee.id,
          requested_by: employee.id,
          tanggal: koreksiForm.tanggal,
          status: 'pending',
          alasan: koreksiForm.alasan.trim(),
          before_clock_in: existingRow?.clock_in || null,
          before_clock_out: existingRow?.clock_out || null,
          before_status_telat: existingRow?.status_telat ?? null,
          after_clock_in: afterClockIn,
          after_clock_out: afterClockOut,
          foto_bukti_url: uploadData.driveUrl,
          foto_bukti_drive_id: uploadData.driveFileId,
        }])
        .select()
        .single();

      if (insertError) throw insertError;

      setMyCorrections((prev) => [inserted, ...prev]);
      setShowKoreksiForm(false);
    } catch (err) {
      setKoreksiError(err.message || 'Gagal mengirim pengajuan koreksi.');
    } finally {
      setKoreksiSaving(false);
    }
  };

  // Batalkan pengajuan koreksi yang masih pending. Validasi di server; kalau
  // sudah diproses superadmin, server membalas 409 dan status disinkronkan.
  const handleCancelKoreksi = async (row) => {
    const konfirmasi = window.confirm(
      `Batalkan pengajuan koreksi absensi tanggal ${formatTanggal(row.tanggal)}?\n\nKalau masih perlu dikoreksi, kamu harus mengajukan ulang dan mengunggah foto bukti lagi.`
    );
    if (!konfirmasi) return;

    setKoreksiCancelError(null);
    setCancelingKoreksiId(row.id);
    try {
      const res = await fetch(`/api/attendance/koreksi/${row.id}/cancel`, { method: 'POST' });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 409 && json.status) {
          setMyCorrections((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: json.status } : r)));
        }
        setKoreksiCancelError(json.error || 'Gagal membatalkan pengajuan koreksi, coba lagi.');
        return;
      }

      setMyCorrections((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: 'cancelled' } : r)));
    } catch {
      setKoreksiCancelError('Gagal membatalkan pengajuan koreksi. Periksa koneksi internet kamu.');
    } finally {
      setCancelingKoreksiId(null);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat data absensi..." />
      </section>
    );
  }

  if (status === 'denied') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Kamu tidak punya akses ke halaman Absensi.</p>
          <Link
            href="/employee/dashboard"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali
          </Link>
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px]">
          <ErrorState message={loadError} onRetry={loadClockData} />
        </div>
      </section>
    );
  }

  const isWorkday = schedule?.hari_kerja?.includes(HARI_LABEL[new Date().getDay()]);

  return (
    <div className="max-w-[700px] mx-auto px-6 py-10">
      <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-1">Absensi</h1>
      <p className="text-sm text-[#6B6B6B] mb-8">Halo, {employee?.nama}. {formatTanggal(todayStr())}.</p>

      {forgotClockOut && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-3 mb-6">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Kamu clock in pada {formatTanggal(forgotClockOut.tanggal)} pukul {formatWaktu(forgotClockOut.clock_in)} tapi belum clock out.
          Kalau ini kelupaan, hubungi superadmin untuk koreksi manual.
        </div>
      )}
      {!schedule && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-4 py-3 mb-6">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Jadwal kerja kamu belum diatur, jadi status telat belum bisa dihitung. Clock in/out tetap bisa dilakukan.
        </div>
      )}
      {schedule && !isWorkday && (
        <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#6B6B6B] text-xs px-4 py-3 mb-6">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Hari ini bukan hari kerja terjadwal kamu.
        </div>
      )}
      {!hasReferensiWajah && (
        <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#6B6B6B] text-xs px-4 py-3 mb-6">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Kamu belum daftar foto wajah referensi, jadi absensi belum bisa diverifikasi otomatis.{' '}
          <Link href="/employee/profile" className="underline font-medium hover:text-black">Daftarkan di halaman Profil</Link>.
        </div>
      )}
      {geoError && (
        <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 mb-6">
          <span className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {geoError}
          </span>
          {lastMode && (
            <button
              onClick={() => openCamera(lastMode)}
              className="shrink-0 underline font-medium hover:text-red-900"
            >
              Coba Lagi
            </button>
          )}
        </div>
      )}
      <div className="bg-white border border-[#E0E0E0] p-6 mb-8">
        <LiveClock className="mb-4" />

        {schedule && (
          <p className="text-xs text-[#9A9A9A] mb-4">
            Jadwal: {formatJam(schedule.jam_masuk)} – {formatJam(schedule.jam_pulang)}
            {schedule.toleransi_menit > 0 && ` · Toleransi keterlambatan ${schedule.toleransi_menit} menit`}
          </p>
        )}

        <div className="flex items-start gap-2 text-xs text-[#6B6B6B] mb-4">
          <MapPin size={13} className="mt-0.5 shrink-0" />
          {lockedLocations.length > 0 ? (
            <span>
              Lokasi kamu di-lock ke{' '}
              <span className="font-medium text-black">
                {lockedLocations.map((l) => l.nama).join(', ')}
              </span>
              . Clock in/out cuma dicek jaraknya ke lokasi ini (radius{' '}
              {lockedLocations.map((l) => `${l.radius_meter}m`).join(', ')}).
            </span>
          ) : (
            <span>Lokasi kamu belum di-lock ke kantor/klien tertentu — clock in/out bisa dari lokasi manapun yang terdaftar.</span>
          )}
        </div>

        {!todayRow ? (
          <>
            <p className="text-sm text-black mb-4">Kamu belum clock in hari ini.</p>
            <button
              onClick={() => openCamera('in')}
              disabled={acting}
              className="flex items-center gap-2 bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              <Camera size={16} />
              {acting ? 'Memproses...' : 'Clock In'}
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap text-sm text-black">
              <CheckCircle2 size={16} className="text-madael-red" />
              Clock in pukul {formatWaktu(todayRow.clock_in)}
              {todayRow.status_telat && <AttendanceStatusBadge row={todayRow} />}
              {todayRow.clock_in_dalam_radius === false && (
                <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-amber-100 text-amber-800">
                  DI LUAR RADIUS
                </span>
              )}
              {todayRow.wajah_terverifikasi === false && (
                <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-amber-100 text-amber-800">
                  WAJAH PERLU REVIEW
                  {todayRow.wajah_similarity != null ? ` (${similarityPercent(todayRow.wajah_similarity)}%)` : ''}
                </span>
              )}
              {todayRow.wajah_terverifikasi === true && todayRow.wajah_similarity != null && (
                <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-green-100 text-green-700">
                  WAJAH COCOK ({similarityPercent(todayRow.wajah_similarity)}%)
                </span>
              )}
            </div>

            {todayRow.status_telat && (
              <LateReasonBox
                key={`${todayRow.id}-${todayRow.justified}`}
                row={todayRow}
                onSaved={setTodayRow}
              />
            )}

            {!todayRow.clock_out ? (
              <button
                onClick={() => openCamera('out')}
                disabled={acting}
                className="flex items-center gap-2 bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
              >
                <Camera size={16} />
                {acting ? 'Memproses...' : 'Clock Out'}
              </button>
            ) : (
              <div className="flex items-center gap-2 text-sm text-black">
                <Clock size={16} className="text-[#9A9A9A]" />
                Clock out pukul {formatWaktu(todayRow.clock_out)} — absensi hari ini selesai.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-medium text-black">Riwayat Absensi</h2>
          <p className="text-xs text-[#9A9A9A] mt-0.5">{formatBulan(monthValue)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMonthValue((m) => shiftMonth(m, -1))}
            aria-label="Bulan sebelumnya"
            className="border border-[#E0E0E0] bg-white p-2 text-[#6B6B6B] hover:text-black hover:border-madael-red transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <input
            type="month"
            value={monthValue}
            max={currentMonthValue()}
            onChange={(e) => {
              if (e.target.value) setMonthValue(e.target.value);
            }}
            className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
          />
          <button
            type="button"
            onClick={() => setMonthValue((m) => shiftMonth(m, 1))}
            disabled={monthValue >= currentMonthValue()}
            aria-label="Bulan berikutnya"
            className="border border-[#E0E0E0] bg-white p-2 text-[#6B6B6B] hover:text-black hover:border-madael-red transition-colors disabled:opacity-40 disabled:hover:text-[#6B6B6B] disabled:hover:border-[#E0E0E0]"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {summary && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            {[
              ['Hadir', summary.totalHadir],
              ['Telat', summary.totalTelat],
              ['Tanpa Kehadiran', summary.totalTidakHadir ?? '—'],
              ['Cuti', summary.cutiHari],
            ].map(([label, value]) => (
              <div key={label} className="bg-white border border-[#E0E0E0] px-4 py-3">
                <p className="text-[11px] text-[#9A9A9A] mb-1">{label}</p>
                <p className="text-lg text-black">{value}</p>
              </div>
            ))}
          </div>
          {summary.totalTidakHadir === null && (
            <p className="text-xs text-[#9A9A9A] mb-3">
              Jadwal kerja kamu belum diatur, jadi hari tanpa kehadiran belum bisa dihitung.
            </p>
          )}
        </>
      )}

      <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
        {monthError ? (
          <ErrorState message={monthError} onRetry={loadMonth} />
        ) : !summary ? (
          <LoadingState label="Memuat riwayat absensi..." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Clock In</th>
                <th className="px-4 py-3 font-medium">Clock Out</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.days.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-0">
                    <EmptyState message="Belum ada data absensi di bulan ini." />
                  </td>
                </tr>
              ) : (
                summary.days.map(({ tanggal, kind, row }) => (
                  <tr key={tanggal} className="border-b border-[#E0E0E0] last:border-0">
                    <td className="px-4 py-3 text-black">{formatTanggal(tanggal)}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{formatWaktu(row?.clock_in)}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{formatWaktu(row?.clock_out)}</td>
                    <td className="px-4 py-3">
                      {kind === 'tidak_hadir' && (
                        <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-red-100 text-red-700">
                          TANPA KEHADIRAN
                        </span>
                      )}
                      {kind === 'cuti' && (
                        <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-[#F4F4F4] text-[#6B6B6B]">
                          CUTI
                        </span>
                      )}
                      {(kind === 'tepat' || kind === 'telat') && (
                        <AttendanceStatusBadge row={row} showNote />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between mt-10 mb-3">
        <h2 className="text-sm font-medium text-black">Pengajuan Koreksi Kehadiran</h2>
        <button
          onClick={openKoreksiForm}
          className="flex items-center gap-1.5 text-xs font-medium tracking-[0.02em] text-madael-red hover:text-madael-dark"
        >
          <FileEdit size={14} />
          Ajukan Koreksi
        </button>
      </div>
      <p className="text-xs text-[#9A9A9A] mb-3">
        Kalau lupa clock in/out atau ada kesalahan, ajukan koreksi mandiri di sini lengkap dengan foto bukti. Superadmin akan mereview sebelum data absensi kamu ikut berubah.
      </p>
      {koreksiCancelError && <p className="text-xs text-red-600 mb-3">{koreksiCancelError}</p>}
      <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
              <th className="px-4 py-3 font-medium">Tanggal</th>
              <th className="px-4 py-3 font-medium">Diajukan</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Bukti</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {myCorrections.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-0">
                  <EmptyState message="Belum ada pengajuan koreksi." />
                </td>
              </tr>
            ) : (
              myCorrections.map((row) => (
                <tr key={row.id} className="border-b border-[#E0E0E0] last:border-0">
                  <td className="px-4 py-3 text-black">{formatTanggal(row.tanggal)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">
                    Masuk {formatWaktu(row.after_clock_in)} — Pulang {formatWaktu(row.after_clock_out)}
                  </td>
                  <td className="px-4 py-3">
                    {row.status === 'pending' && (
                      <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-amber-100 text-amber-700">
                        MENUNGGU
                      </span>
                    )}
                    {row.status === 'approved' && (
                      <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-green-100 text-green-700">
                        DISETUJUI
                      </span>
                    )}
                    {row.status === 'rejected' && (
                      <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-red-100 text-red-700">
                        DITOLAK
                      </span>
                    )}
                    {row.status === 'cancelled' && (
                      <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-[#F4F4F4] text-[#6B6B6B]">
                        DIBATALKAN
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.foto_bukti_url ? (
                      <a
                        href={row.foto_bukti_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark"
                      >
                        Lihat <ExternalLink size={12} />
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {row.status === 'pending' ? (
                      <button
                        type="button"
                        onClick={() => handleCancelKoreksi(row)}
                        disabled={cancelingKoreksiId === row.id}
                        className="text-xs font-medium text-madael-red hover:text-madael-dark disabled:opacity-50"
                      >
                        {cancelingKoreksiId === row.id ? 'Membatalkan...' : 'Batalkan'}
                      </button>
                    ) : (
                      <span className="text-xs text-[#9A9A9A]">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showKoreksiForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] px-6" onClick={handleKoreksiModalBackdrop}>
          <div className="bg-white w-full max-w-[440px] p-6 relative max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowKoreksiForm(false)}
              className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black"
            >
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-4">Ajukan Koreksi Kehadiran</h2>

            {koreksiError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2.5 mb-4">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {koreksiError}
              </div>
            )}

            <label className="block text-xs font-medium text-[#6B6B6B] mb-1.5">Tanggal</label>
            <input
              type="date"
              value={koreksiForm.tanggal}
              max={todayStr()}
              onChange={(e) => setKoreksiForm((f) => ({ ...f, tanggal: e.target.value }))}
              className="w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white mb-4 focus:outline-none focus:border-madael-red"
            />

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-[#6B6B6B] mb-1.5">Jam Masuk Seharusnya</label>
                <input
                  type="time"
                  value={koreksiForm.jamMasuk}
                  onChange={(e) => setKoreksiForm((f) => ({ ...f, jamMasuk: e.target.value }))}
                  className="w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B6B6B] mb-1.5">Jam Pulang Seharusnya</label>
                <input
                  type="time"
                  value={koreksiForm.jamPulang}
                  onChange={(e) => setKoreksiForm((f) => ({ ...f, jamPulang: e.target.value }))}
                  className="w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red"
                />
              </div>
            </div>

            <label className="block text-xs font-medium text-[#6B6B6B] mb-1.5">Alasan</label>
            <textarea
              value={koreksiForm.alasan}
              onChange={(e) => setKoreksiForm((f) => ({ ...f, alasan: e.target.value }))}
              rows={3}
              placeholder="Contoh: lupa clock in karena HP mati, tapi sudah masuk kerja sejak jam 08.00"
              className="w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white mb-4 focus:outline-none focus:border-madael-red resize-none"
            />

            <label className="block text-xs font-medium text-[#6B6B6B] mb-1.5">Foto Bukti (wajib)</label>
            <label className="flex items-center gap-2 border border-dashed border-[#E0E0E0] px-3 py-3 text-xs text-[#6B6B6B] mb-1 cursor-pointer hover:border-madael-red">
              <Upload size={14} />
              {koreksiFoto ? koreksiFoto.name : 'Pilih atau ambil foto (JPG/PNG, maks 5MB)'}
              <input
                type="file"
                accept="image/jpeg,image/png"
                capture="environment"
                onChange={(e) => setKoreksiFoto(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
            <p className="text-[11px] text-[#9A9A9A] mb-5">
              Bukti bisa berupa foto kegiatan kerja, absensi manual fisik, atau bukti lain yang menunjukkan kamu benar-benar bekerja pada tanggal tersebut.
            </p>

            <button
              onClick={handleSubmitKoreksi}
              disabled={koreksiSaving}
              className="w-full flex items-center justify-center gap-2 bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {koreksiSaving ? 'Mengirim...' : 'Kirim Pengajuan'}
            </button>
          </div>
        </div>
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