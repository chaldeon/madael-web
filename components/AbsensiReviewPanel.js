'use client';

// Daftar absensi yang di-flag: di luar radius lokasi kerja, wajah tidak cocok
// foto referensi, akurasi GPS buruk/tidak terbaca, verifikasi wajah dilewati
// berulang, atau descriptor wajah yang mencurigakan (identik berulang / persis sama
// dengan referensi). Absensinya tetap tersimpan (tidak diblokir) — panel
// ini murni buat review manual. Dirender sebagai tab "Perlu Review" di
// app/employee/absensi/karyawan/page.js.
//
// Karena descriptor wajah dihitung di browser (server tidak bisa membuktikan
// descriptor itu berasal dari foto absen), tiap baris menampilkan foto referensi
// berdampingan dengan foto absen supaya wajahnya bisa dicocokkan dengan mata. Mode
// "Sampel Audit" menarik baris acak yang LOLOS verifikasi, karena justru itu yang
// tidak pernah masuk daftar review.

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { similarityPercent } from '@/lib/faceVerification';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { resolveAttendancePhotoUrls } from '@/lib/attendancePhotoUrl';
import { findDescriptorAnomalies, pickSample, SAMPEL_AUDIT_JUMLAH } from '@/lib/attendanceFaceAudit';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import { friendlyError } from '@/lib/errorMessage';

const ROW_SELECT = '*, employees:employee_id ( nama, foto_referensi_url )';
const FLAG_FILTER = 'clock_in_dalam_radius.eq.false,clock_out_dalam_radius.eq.false,wajah_terverifikasi.eq.false,gps_akurasi_buruk.eq.true,wajah_dilewati_berulang.eq.true';
const ID_CHUNK = 100;

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatWaktu(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

// "AKURASI GPS BURUK (masuk ±120 m · pulang ±300 m)"; kalau tidak ada angka sama
// sekali (klien lama / panggilan API langsung) -> "AKURASI GPS TIDAK TERBACA".
function formatAkurasiBadge(row) {
  const bagian = [];
  if (row.clock_in_akurasi_meter != null) bagian.push(`masuk ±${Math.round(row.clock_in_akurasi_meter)} m`);
  if (row.clock_out_akurasi_meter != null) bagian.push(`pulang ±${Math.round(row.clock_out_akurasi_meter)} m`);
  if (bagian.length === 0) return 'AKURASI GPS TIDAK TERBACA';
  return `AKURASI GPS BURUK (${bagian.join(' · ')})`;
}

// Satu foto kecil; klik membuka ukuran penuh di tab baru.
function Thumb({ src, label }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {src ? (
        <a href={src} target="_blank" rel="noopener noreferrer">
          <img
            src={src}
            alt={label}
            loading="lazy"
            className="w-16 h-16 object-cover border border-[#E0E0E0]"
          />
        </a>
      ) : (
        <div className="w-16 h-16 flex items-center justify-center bg-[#F4F4F4] border border-[#E0E0E0] text-[9px] text-[#9A9A9A] text-center leading-tight">
          Tidak ada foto
        </div>
      )}
      <span className="text-[10px] text-[#6B6B6B]">{label}</span>
    </div>
  );
}

// Ambil baris attendance berdasarkan daftar id (dipecah supaya URL query tidak kepanjangan).
async function fetchRowsByIds(supabase, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from('attendance')
      .select(ROW_SELECT)
      .in('id', ids.slice(i, i + ID_CHUNK));
    if (error) return { data: null, error };
    out.push(...(data || []));
  }
  return { data: out, error: null };
}

export default function AbsensiReviewPanel({ supabase }) {
  const [monthValue, setMonthValue] = useState(currentMonthValue());
  const [mode, setMode] = useState('review'); // 'review' | 'sampel'
  const [sampelNonce, setSampelNonce] = useState(0);
  const [rows, setRows] = useState([]);
  const [anomalies, setAnomalies] = useState(new Map());
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [year, month] = monthValue.split('-').map(Number);
    const firstDay = `${monthValue}-01`;
    const lastDayNum = new Date(year, month, 0).getDate();
    const lastDay = `${monthValue}-${String(lastDayNum).padStart(2, '0')}`;
    const gagal = (error) => {
      setLoadError(friendlyError(error, 'Gagal memuat data yang perlu direview. Pastikan migrasi geofencing dan migrasi akurasi GPS sudah dijalankan.'));
      setLoading(false);
    };

    // Jarak wajah seluruh absensi bulan ini (kolom sempit) untuk mendeteksi descriptor
    // yang identik berulang / persis sama dengan referensi.
    const faceRes = await fetchAllRows(() =>
      supabase
        .from('attendance')
        .select('id, employee_id, wajah_similarity')
        .gte('tanggal', firstDay)
        .lte('tanggal', lastDay)
        .not('wajah_similarity', 'is', null)
    );
    if (faceRes.error) return gagal(faceRes.error);
    const anomalyMap = findDescriptorAnomalies(faceRes.data);

    let result;
    if (mode === 'sampel') {
      // Sampel acak dari absensi berfoto yang lolos verifikasi wajah.
      const candRes = await fetchAllRows(() =>
        supabase
          .from('attendance')
          .select('id')
          .gte('tanggal', firstDay)
          .lte('tanggal', lastDay)
          .eq('wajah_terverifikasi', true)
          .not('foto_clock_in_url', 'is', null)
      );
      if (candRes.error) return gagal(candRes.error);
      const picked = pickSample((candRes.data || []).map((r) => r.id), SAMPEL_AUDIT_JUMLAH);
      result = await fetchRowsByIds(supabase, picked);
    } else {
      const flaggedRes = await fetchAllRows(() =>
        supabase
          .from('attendance')
          .select(ROW_SELECT)
          .gte('tanggal', firstDay)
          .lte('tanggal', lastDay)
          .or(FLAG_FILTER)
          .order('tanggal', { ascending: false })
      );
      if (flaggedRes.error) return gagal(flaggedRes.error);
      const have = new Set((flaggedRes.data || []).map((r) => r.id));
      const extraIds = [...anomalyMap.keys()].filter((id) => !have.has(id));
      const extraRes = await fetchRowsByIds(supabase, extraIds);
      if (extraRes.error) return gagal(extraRes.error);
      result = { data: [...(flaggedRes.data || []), ...extraRes.data], error: null };
    }
    if (result.error) return gagal(result.error);

    const list = (result.data || []).slice().sort((a, b) => (a.tanggal < b.tanggal ? 1 : a.tanggal > b.tanggal ? -1 : 0));
    const urls = await resolveAttendancePhotoUrls(
      supabase,
      list.flatMap((r) => [r.foto_clock_in_url, r.foto_clock_out_url])
    );

    setAnomalies(anomalyMap);
    setPhotoUrls(urls);
    setRows(list);
    setLoading(false);
  }, [supabase, monthValue, mode, sampelNonce]);

  useEffect(() => { load(); }, [load]);

  const modeButton = (value, label) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`px-4 py-2 text-xs font-medium tracking-[0.04em] border transition-colors ${
        mode === value
          ? 'bg-madael-red text-white border-madael-red'
          : 'bg-white text-[#6B6B6B] border-[#E0E0E0] hover:border-madael-red'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex">
          {modeButton('review', 'Perlu Review')}
          {modeButton('sampel', 'Sampel Audit')}
        </div>
        <div className="flex items-center gap-2">
          {mode === 'sampel' && (
            <button
              type="button"
              onClick={() => setSampelNonce((n) => n + 1)}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs text-[#6B6B6B] border border-[#E0E0E0] bg-white hover:border-madael-red disabled:opacity-50"
            >
              <RefreshCw size={12} />
              Acak ulang
            </button>
          )}
          <input
            type="month"
            value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)}
            className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red"
          />
        </div>
      </div>

      <p className="text-xs text-[#6B6B6B] max-w-[640px] mb-6">
        {mode === 'review'
          ? 'Absensi yang tercatat di luar radius lokasi kerja terdaftar, wajah tidak cocok dengan foto referensi, akurasi GPS buruk, verifikasi wajah berulang kali dilewati, atau descriptor wajahnya mencurigakan (jarak kemiripan identik berulang / persis sama dengan referensi). Absensinya tetap tersimpan — ini cuma daftar untuk direview manual. Bandingkan foto referensi dengan foto absen.'
          : `Sampel acak (maks. ${SAMPEL_AUDIT_JUMLAH}) absensi berfoto yang LOLOS verifikasi wajah. Verifikasi dihitung dari data yang dikirim browser, jadi cek berkala dengan mata tetap perlu: cocokkan foto referensi dengan foto absen.`}
      </p>

      {loading ? (
        <LoadingState label="Memuat data yang perlu direview..." />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : rows.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState
            message={mode === 'review'
              ? 'Tidak ada absensi yang perlu direview bulan ini.'
              : 'Tidak ada absensi berfoto yang lolos verifikasi bulan ini untuk disampel.'}
            icon={AlertTriangle}
          />
        </div>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Nama</th>
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Clock In</th>
                <th className="px-4 py-3 font-medium">Clock Out</th>
                <th className="px-4 py-3 font-medium">Foto</th>
                <th className="px-4 py-3 font-medium">Masalah</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const anomali = anomalies.get(row.id);
                const referensiUrl = row.employees?.foto_referensi_url
                  ? `/api/attendance/foto-referensi/${row.employee_id}`
                  : null;
                return (
                  <tr key={row.id} className="border-b border-[#E0E0E0] last:border-0 align-top">
                    <td className="px-4 py-3 text-black">{row.employees?.nama || '—'}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{formatTanggal(row.tanggal)}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{formatWaktu(row.clock_in)}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{formatWaktu(row.clock_out)}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Thumb src={referensiUrl} label="Referensi" />
                        <Thumb src={row.foto_clock_in_url ? photoUrls[row.foto_clock_in_url] : null} label="Masuk" />
                        <Thumb src={row.foto_clock_out_url ? photoUrls[row.foto_clock_out_url] : null} label="Pulang" />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {row.clock_in_dalam_radius === false && (
                          <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-amber-100 text-amber-800">
                            MASUK DI LUAR RADIUS{row.clock_in_jarak_meter != null ? ` (${row.clock_in_jarak_meter}m)` : ''}
                          </span>
                        )}
                        {row.clock_out_dalam_radius === false && (
                          <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-amber-100 text-amber-800">
                            PULANG DI LUAR RADIUS{row.clock_out_jarak_meter != null ? ` (${row.clock_out_jarak_meter}m)` : ''}
                          </span>
                        )}
                        {row.gps_akurasi_buruk && (
                          <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-amber-100 text-amber-800">
                            {formatAkurasiBadge(row)}
                          </span>
                        )}
                        {row.wajah_dilewati_berulang && (
                          <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-amber-100 text-amber-800">
                            VERIFIKASI WAJAH DILEWATI BERULANG
                          </span>
                        )}
                        {row.wajah_terverifikasi === false && (
                          <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-red-100 text-red-700">
                            WAJAH TIDAK COCOK
                            {row.wajah_similarity != null ? ` (${similarityPercent(row.wajah_similarity)}% mirip)` : ''}
                          </span>
                        )}
                        {anomali?.identikHari > 0 && (
                          <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-amber-100 text-amber-800">
                            DESCRIPTOR IDENTIK {anomali.identikHari}× BULAN INI
                          </span>
                        )}
                        {anomali?.samaReferensi && (
                          <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-red-100 text-red-700">
                            DESCRIPTOR PERSIS SAMA DENGAN REFERENSI
                          </span>
                        )}
                        {mode === 'sampel' && !row.wajah_dilewati_berulang && row.wajah_terverifikasi !== false
                          && !anomali && row.gps_akurasi_buruk !== true
                          && row.clock_in_dalam_radius !== false && row.clock_out_dalam_radius !== false && (
                          <span className="text-[11px] text-[#9A9A9A]">
                            Lolos verifikasi{row.wajah_similarity != null ? ` (${similarityPercent(row.wajah_similarity)}% mirip)` : ''}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
