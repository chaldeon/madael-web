'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { AlertTriangle, MapPin } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';

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

function ClockCell({ waktu, fotoUrl, lat, lng }) {
  if (!waktu) {
    return <span className="text-xs text-[#9A9A9A]">—</span>;
  }
  return (
    <div className="flex items-center gap-3">
      {fotoUrl ? (
        <a href={fotoUrl} target="_blank" rel="noopener noreferrer">
          <img
            src={fotoUrl}
            alt="Foto absen"
            className="w-12 h-12 object-cover border border-[#E0E0E0]"
          />
        </a>
      ) : (
        <div className="w-12 h-12 flex items-center justify-center bg-[#F4F4F4] border border-[#E0E0E0] text-[9px] text-[#9A9A9A] text-center leading-tight">
          Tidak ada foto
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-black">{formatWaktu(waktu)}</span>
        {lat && lng ? (
          <a
            href={`https://www.google.com/maps?q=${lat},${lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-madael-red hover:text-madael-dark"
          >
            <MapPin size={11} />
            Lihat lokasi
          </a>
        ) : (
          <span className="text-[11px] text-[#9A9A9A]">Lokasi tidak ada</span>
        )}
      </div>
    </div>
  );
}

export default function RekapDetailPage() {
  const { employeeId } = useParams();
  const searchParams = useSearchParams();
  const monthValue = searchParams.get('month') || currentMonthValue();

  const supabase = createClient();
  const { status, employee } = useModuleAccess('absensi');
  const isSuperadmin = !!employee?.is_superadmin;

  const [emp, setEmp] = useState(null);
  const [rows, setRows] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [year, month] = monthValue.split('-').map(Number);
    const firstDay = `${monthValue}-01`;
    const lastDayNum = new Date(year, month, 0).getDate();
    const lastDay = `${monthValue}-${String(lastDayNum).padStart(2, '0')}`;

    const [{ data: empData }, { data: att }] = await Promise.all([
      supabase.from('employees').select('id, nama, perusahaan').eq('id', employeeId).maybeSingle(),
      supabase
        .from('attendance')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('tanggal', firstDay)
        .lte('tanggal', lastDay)
        .order('tanggal', { ascending: false }),
    ]);

    setEmp(empData || null);
    setRows(att || []);

    const paths = [];
    (att || []).forEach((r) => {
      if (r.foto_clock_in_url) paths.push(r.foto_clock_in_url);
      if (r.foto_clock_out_url) paths.push(r.foto_clock_out_url);
    });

    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from('attendance-photos')
        .createSignedUrls(paths, 60 * 60);
      const map = {};
      (signed || []).forEach((s) => {
        if (s?.signedUrl && s?.path) map[s.path] = s.signedUrl;
      });
      setPhotoUrls(map);
    } else {
      setPhotoUrls({});
    }

    setLoading(false);
  }, [supabase, employeeId, monthValue]);

  useEffect(() => {
    if (status === 'allowed' && isSuperadmin) loadData();
  }, [status, isSuperadmin, loadData]);

  if (status === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
      </section>
    );
  }

  if (status === 'denied' || !isSuperadmin) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Halaman ini khusus superadmin.</p>
          <Link
            href="/employee/absensi"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">
            {loading ? 'Memuat...' : (emp?.nama || 'Karyawan tidak ditemukan')}
          </h1>
          <p className="text-sm text-[#6B6B6B] mt-1">
            {emp?.perusahaan ? `${emp.perusahaan} — ` : ''}Log kehadiran bulan {monthValue}.
          </p>
        </div>
        <Link href="/employee/absensi/rekap" className="text-sm text-[#6B6B6B] hover:text-madael-red">
          ← Rekap Bulanan
        </Link>
      </div>

      <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#6B6B6B] text-xs px-4 py-3 mb-6">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        Foto dan lokasi di bawah dipakai untuk verifikasi manual — bukan hasil pencocokan wajah otomatis.
      </div>

      {loading ? (
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
      ) : (
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
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-xs text-[#9A9A9A]">
                    Belum ada data absensi bulan ini.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-[#E0E0E0] last:border-0 align-top">
                    <td className="px-4 py-3 text-black whitespace-nowrap">{formatTanggal(row.tanggal)}</td>
                    <td className="px-4 py-3">
                      <ClockCell
                        waktu={row.clock_in}
                        fotoUrl={row.foto_clock_in_url ? photoUrls[row.foto_clock_in_url] : null}
                        lat={row.clock_in_lat}
                        lng={row.clock_in_lng}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <ClockCell
                        waktu={row.clock_out}
                        fotoUrl={row.foto_clock_out_url ? photoUrls[row.foto_clock_out_url] : null}
                        lat={row.clock_out_lat}
                        lng={row.clock_out_lng}
                      />
                    </td>
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
      )}
    </div>
  );
}