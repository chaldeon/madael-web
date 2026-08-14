'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { MapPin, Clock, CheckCircle2, AlertTriangle, Camera, X, FileEdit, Upload, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

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

function captureFrame(videoEl) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Gagal membuat canvas untuk foto.'));
      return;
    }
    ctx.drawImage(videoEl, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Gagal mengambil foto dari kamera.'));
        return;
      }
      resolve(blob);
    }, 'image/jpeg', 0.85);
  });
}

export default function AbsensiPage() {
  const supabase = createClient();
  const { status, employee } = useModuleAccess('absensi');

  const [schedule, setSchedule] = useState(null);
  const [todayRow, setTodayRow] = useState(null);
  const [history, setHistory] = useState([]);
  const [forgotClockOut, setForgotClockOut] = useState(null); // record kemarin kalau clock in ada tapi clock out kosong
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [acting, setActing] = useState(false);
  const [geoError, setGeoError] = useState(null);
  const [lastMode, setLastMode] = useState(null); // untuk tombol retry saat gagal simpan

  const [cameraMode, setCameraMode] = useState(null); // 'in' | 'out' | null
  const [cameraError, setCameraError] = useState(null);
  const [cameraStream, setCameraStream] = useState(null);
  const videoRef = useRef(null);

  // --- Pengajuan koreksi absensi mandiri ---
  const [myCorrections, setMyCorrections] = useState([]);
  const [showKoreksiForm, setShowKoreksiForm] = useState(false);
  const [koreksiForm, setKoreksiForm] = useState({ tanggal: todayStr(), jamMasuk: '', jamPulang: '', alasan: '' });
  const [koreksiFoto, setKoreksiFoto] = useState(null);
  const [koreksiSaving, setKoreksiSaving] = useState(false);
  const [koreksiError, setKoreksiError] = useState(null);
  

  const loadData = useCallback(async () => {
    if (!employee) return;
    setLoading(true);
    setLoadError(null);

    const [schedRes, todayRes, histRes, yesterdayRes, correctionsRes] = await Promise.all([
      supabase.from('work_schedule').select('*').eq('employee_id', employee.id).maybeSingle(),
      supabase.from('attendance').select('*').eq('employee_id', employee.id).eq('tanggal', todayStr()).maybeSingle(),
      supabase
        .from('attendance')
        .select('*')
        .eq('employee_id', employee.id)
        .order('tanggal', { ascending: false })
        .limit(7),
      supabase.from('attendance').select('*').eq('employee_id', employee.id).eq('tanggal', yesterdayStr()).maybeSingle(),
      supabase
        .from('attendance_corrections')
        .select('*')
        .eq('requested_by', employee.id)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    const firstError = schedRes.error || todayRes.error || histRes.error || yesterdayRes.error || correctionsRes.error;
    if (firstError) {
      setLoadError(firstError.message || 'Gagal memuat data absensi. Periksa koneksi internet kamu.');
      setLoading(false);
      return;
    }

    setSchedule(schedRes.data || null);
    setTodayRow(todayRes.data || null);
    setHistory(histRes.data || []);
    const yRow = yesterdayRes.data || null;
    setForgotClockOut(yRow && yRow.clock_in && !yRow.clock_out ? yRow : null);
    setMyCorrections(correctionsRes.data || []);
    setLoading(false);
  }, [supabase, employee]);

  useEffect(() => {
    if (status === 'allowed') loadData();
  }, [status, loadData]);

  const openCamera = async (mode) => {
    setGeoError(null);
    setCameraError(null);
    setLastMode(mode);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      setCameraStream(stream);
      setCameraMode(mode);
    } catch (err) {
      setCameraError('Tidak bisa mengakses kamera. Pastikan izin kamera diaktifkan di browser.');
    }
  };

  // Video element baru mount setelah cameraMode diset, jadi stream baru
  // di-attach setelah render berikutnya.
  useEffect(() => {
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream, cameraMode]);

  const closeCamera = () => {
    cameraStream?.getTracks().forEach((t) => t.stop());
    setCameraStream(null);
    setCameraMode(null);
  };

  const uploadFoto = async (blob, mode) => {
    const path = `${employee.id}/${todayStr()}-${mode}-${Date.now()}.jpg`;
    const { error } = await supabase.storage.from('attendance-photos').upload(path, blob, {
      contentType: 'image/jpeg',
    });
    if (error) throw error;
    return path;
  };

  const handleConfirmCapture = async () => {
    const mode = cameraMode;
    setActing(true);
    setGeoError(null);

    let fotoPath = null;
    let wajahOk = false;
    try {
      const blob = await captureFrame(videoRef.current);
      fotoPath = await uploadFoto(blob, mode);
      wajahOk = true;
    } catch (err) {
      // Foto gagal diambil/diupload — tetap lanjut absen, tapi flag verifikasi
      // ditandai gagal supaya bisa dicek manual nanti.
      setGeoError('Foto gagal disimpan, tapi absen tetap diproses. (' + (err.message || 'error kamera') + ')');
    }
    closeCamera();

    try {
      const pos = await getPosition();
      const now = new Date();

      if (mode === 'in') {
        const isLate = schedule ? timeStr(now) > schedule.jam_masuk : false;
        const { data, error } = await supabase
          .from('attendance')
          .insert([{
            employee_id: employee.id,
            tanggal: todayStr(),
            clock_in: now.toISOString(),
            clock_in_lat: pos.coords.latitude,
            clock_in_lng: pos.coords.longitude,
            status_telat: isLate,
            foto_clock_in_url: fotoPath,
            wajah_terverifikasi: wajahOk,
          }])
          .select()
          .single();

        if (error) throw error;
        setTodayRow(data);
        setHistory((h) => [data, ...h.filter((r) => r.tanggal !== data.tanggal)].slice(0, 7));
      } else {
        const { data, error } = await supabase
          .from('attendance')
          .update({
            clock_out: now.toISOString(),
            clock_out_lat: pos.coords.latitude,
            clock_out_lng: pos.coords.longitude,
            foto_clock_out_url: fotoPath,
            wajah_terverifikasi: todayRow.wajah_terverifikasi || wajahOk,
          })
          .eq('id', todayRow.id)
          .select()
          .single();

        if (error) throw error;
        setTodayRow(data);
        setHistory((h) => h.map((r) => (r.id === data.id ? data : r)));
      }
    } catch (err) {
      setGeoError(err.message || 'Gagal mengambil lokasi. Pastikan izin lokasi diaktifkan.');
    } finally {
      setActing(false);
    }
  };

  const openKoreksiForm = () => {
    setKoreksiError(null);
    setKoreksiForm({ tanggal: todayStr(), jamMasuk: '', jamPulang: '', alasan: '' });
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
          <ErrorState message={loadError} onRetry={loadData} />
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
          Kalau ini kelupaan, hubungi admin untuk koreksi manual.
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
      {cameraError && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3 mb-6">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {cameraError}
        </div>
      )}

      <div className="bg-white border border-[#E0E0E0] p-6 mb-8">
        {schedule && (
          <p className="text-xs text-[#9A9A9A] mb-4">
            Jadwal: {formatJam(schedule.jam_masuk)} – {formatJam(schedule.jam_pulang)}
          </p>
        )}

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
            <div className="flex items-center gap-2 text-sm text-black">
              <CheckCircle2 size={16} className="text-madael-red" />
              Clock in pukul {formatWaktu(todayRow.clock_in)}
              {todayRow.status_telat && (
                <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-red-100 text-red-700">
                  TELAT
                </span>
              )}
            </div>

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

      <h2 className="text-sm font-medium text-black mb-3">Riwayat 7 Hari Terakhir</h2>
      <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
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
            {history.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-0">
                  <EmptyState message="Belum ada data absensi bulan ini." />
                </td>
              </tr>
            ) : (
              history.map((row) => (
                <tr key={row.id} className="border-b border-[#E0E0E0] last:border-0">
                  <td className="px-4 py-3 text-black">{formatTanggal(row.tanggal)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{formatWaktu(row.clock_in)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{formatWaktu(row.clock_out)}</td>
                  <td className="px-4 py-3">
                    {row.status_telat ? (
                      <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-red-100 text-red-700">
                        TELAT
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-green-100 text-green-700">
                        TEPAT WAKTU
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
      <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
              <th className="px-4 py-3 font-medium">Tanggal</th>
              <th className="px-4 py-3 font-medium">Diajukan</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Bukti</th>
            </tr>
          </thead>
          <tbody>
            {myCorrections.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-0">
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showKoreksiForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] px-6">
          <div className="bg-white w-full max-w-[440px] p-6 relative max-h-[90vh] overflow-y-auto">
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
              className="w-full border border-[#E0E0E0] px-3 py-2 text-sm mb-4 focus:outline-none focus:border-madael-red"
            />

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-[#6B6B6B] mb-1.5">Jam Masuk Seharusnya</label>
                <input
                  type="time"
                  value={koreksiForm.jamMasuk}
                  onChange={(e) => setKoreksiForm((f) => ({ ...f, jamMasuk: e.target.value }))}
                  className="w-full border border-[#E0E0E0] px-3 py-2 text-sm focus:outline-none focus:border-madael-red"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B6B6B] mb-1.5">Jam Pulang Seharusnya</label>
                <input
                  type="time"
                  value={koreksiForm.jamPulang}
                  onChange={(e) => setKoreksiForm((f) => ({ ...f, jamPulang: e.target.value }))}
                  className="w-full border border-[#E0E0E0] px-3 py-2 text-sm focus:outline-none focus:border-madael-red"
                />
              </div>
            </div>

            <label className="block text-xs font-medium text-[#6B6B6B] mb-1.5">Alasan</label>
            <textarea
              value={koreksiForm.alasan}
              onChange={(e) => setKoreksiForm((f) => ({ ...f, alasan: e.target.value }))}
              rows={3}
              placeholder="Contoh: lupa clock in karena HP mati, tapi sudah masuk kerja sejak jam 08.00"
              className="w-full border border-[#E0E0E0] px-3 py-2 text-sm mb-4 focus:outline-none focus:border-madael-red resize-none"
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

      {cameraMode && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000] px-6">
          <div className="bg-white w-full max-w-[420px] p-6 relative">
            <button
              onClick={closeCamera}
              className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black"
            >
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-4">
              Foto {cameraMode === 'in' ? 'Clock In' : 'Clock Out'}
            </h2>
            <div className="bg-black mb-4 aspect-[3/4] overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
            </div>
            <p className="text-xs text-[#9A9A9A] mb-4">
              Pastikan wajah kamu terlihat jelas di kamera sebelum ambil foto.
            </p>
            <button
              onClick={handleConfirmCapture}
              disabled={acting}
              className="w-full flex items-center justify-center gap-2 bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              <Camera size={16} />
              {acting ? 'Memproses...' : `Ambil Foto & ${cameraMode === 'in' ? 'Clock In' : 'Clock Out'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}