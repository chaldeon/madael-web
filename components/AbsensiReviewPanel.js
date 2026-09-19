'use client';

// Daftar absensi yang di-flag: di luar radius lokasi kerja, atau wajah tidak
// cocok foto referensi. Absensinya tetap tersimpan (tidak diblokir) — panel
// ini murni buat review manual. Dirender sebagai tab "Perlu Review" di
// app/employee/absensi/karyawan/page.js.

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { similarityPercent } from '@/lib/faceVerification';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

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

export default function AbsensiReviewPanel({ supabase }) {
  const [monthValue, setMonthValue] = useState(currentMonthValue());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const loadFlagged = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [year, month] = monthValue.split('-').map(Number);
    const firstDay = `${monthValue}-01`;
    const lastDayNum = new Date(year, month, 0).getDate();
    const lastDay = `${monthValue}-${String(lastDayNum).padStart(2, '0')}`;

    const { data, error } = await supabase
      .from('attendance')
      .select('*, employees:employee_id ( nama )')
      .gte('tanggal', firstDay)
      .lte('tanggal', lastDay)
      .or('clock_in_dalam_radius.eq.false,clock_out_dalam_radius.eq.false,wajah_terverifikasi.eq.false')
      .order('tanggal', { ascending: false });

    if (error) {
      setLoadError(error.message || 'Gagal memuat data yang perlu direview. Pastikan migrasi geofencing sudah dijalankan.');
      setLoading(false);
      return;
    }
    setRows(data || []);
    setLoading(false);
  }, [supabase, monthValue]);

  useEffect(() => { loadFlagged(); }, [loadFlagged]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <p className="text-xs text-[#6B6B6B] max-w-[520px]">
          Absensi yang tercatat di luar radius lokasi kerja terdaftar, atau wajah tidak cocok dengan
          foto referensi. Absensinya tetap tersimpan — ini cuma daftar untuk direview manual.
        </p>
        <input
          type="month"
          value={monthValue}
          onChange={(e) => setMonthValue(e.target.value)}
          className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red"
        />
      </div>

      {loading ? (
        <LoadingState label="Memuat data yang perlu direview..." />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={loadFlagged} />
      ) : rows.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Tidak ada absensi yang perlu direview bulan ini." icon={AlertTriangle} />
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
                <th className="px-4 py-3 font-medium">Masalah</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-[#E0E0E0] last:border-0">
                  <td className="px-4 py-3 text-black">{row.employees?.nama || '—'}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{formatTanggal(row.tanggal)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{formatWaktu(row.clock_in)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{formatWaktu(row.clock_out)}</td>
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
                      {row.wajah_terverifikasi === false && (
                        <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-red-100 text-red-700">
                          WAJAH TIDAK COCOK
                          {row.wajah_similarity != null ? ` (${similarityPercent(row.wajah_similarity)}% mirip)` : ''}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}