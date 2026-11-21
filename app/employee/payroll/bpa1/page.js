'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import { todayWib } from '@/lib/wibTime';
import {
  HALAMAN_BUAT_BPA1_ADA,
  HALAMAN_DETAIL_BPA1_ADA,
  hrefBuatBpa1,
  hrefDetailBpa1,
} from '@/lib/bpa1Rute';

// Daftar BPA1 (BPA-05): satu baris per klien untuk tahun pajak yang dipilih,
// dibaca dari GET /api/bpa1?tahun= (BPA-04). Halaman ini hanya membaca; tidak
// ada data tertanam dan tidak ada simulasi. Otorisasi sebenarnya di server
// (requireBpa1Access); guard modul 'bpa1' ada di layout.js subtree ini.
//
// ASUMSI (belum diuji terhadap DB nyata): tabel bpa1_* adalah USULAN BPA-01 dan
// bisa belum diterapkan — API lalu menjawab 503 dan pesannya ditampilkan apa
// adanya lewat ErrorState.

const STATUS_STYLE = {
  Draft: 'bg-[#F3F4F6] text-[#4B5563]',
  Review: 'bg-amber-100 text-amber-800',
  Final: 'bg-[#DCFCE7] text-[#166534]',
};

// Rentang pilihan tahun: 5 tahun ke belakang sampai 1 tahun ke depan dari
// tahun berjalan (WIB). Batas API 2000–2100 tetap dijaga server.
const TAHUN_KE_BELAKANG = 5;
const TAHUN_KE_DEPAN = 1;

const PESAN_GAGAL_MUAT = 'Gagal memuat daftar BPA1.';

function LabelRedup({ children }) {
  return <span className="text-[11px] text-[#B0B0B0]">{children}</span>;
}

export default function Bpa1DaftarPage() {
  const [tahunIni] = useState(() => Number(todayWib().slice(0, 4)));
  // Usulan: tahun pajak awal = tahun berjalan (WIB); pengguna dapat memilih
  // tahun lain, mis. tahun lalu saat BPA1 dibuat di awal tahun.
  const [tahun, setTahun] = useState(tahunIni);
  const [data, setData] = useState(null); // { tahun, klien: [...] }
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const opsiTahun = useMemo(() => {
    const awal = tahunIni - TAHUN_KE_BELAKANG;
    const akhir = tahunIni + TAHUN_KE_DEPAN;
    return Array.from({ length: akhir - awal + 1 }, (_, i) => akhir - i);
  }, [tahunIni]);

  useEffect(() => {
    // AbortController: bila tahun diganti saat permintaan sebelumnya masih
    // berjalan, hasil lama dibuang supaya tidak menimpa tahun yang baru dipilih.
    const controller = new AbortController();

    async function muat() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/bpa1?tahun=${tahun}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (controller.signal.aborted) return;

        if (!res.ok) {
          setData(null);
          setLoadError(json.error || PESAN_GAGAL_MUAT);
          return;
        }
        if (!Array.isArray(json?.data?.klien)) {
          setData(null);
          setLoadError(`${PESAN_GAGAL_MUAT} Respons server tidak sesuai format yang diharapkan.`);
          return;
        }
        setData({ tahun: json.data.tahun, klien: json.data.klien });
      } catch (err) {
        if (err?.name === 'AbortError') return;
        console.error('Muat daftar BPA1 error:', err);
        setData(null);
        setLoadError(`${PESAN_GAGAL_MUAT} Periksa koneksi lalu coba lagi.`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    muat();
    return () => controller.abort();
  }, [tahun, reloadKey]);

  const klien = data?.klien || [];
  const jumlahDibuat = klien.filter((k) => k.ada_dokumen).length;

  const selectClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  const halamanBelumAda = [
    !HALAMAN_BUAT_BPA1_ADA && 'form Buat BPA1',
    !HALAMAN_DETAIL_BPA1_ADA && 'halaman Detail BPA1',
  ].filter(Boolean);

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">BPA1</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">
          Bukti Potong A1 tahunan per klien — status dan versi dokumen per tahun pajak.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="flex flex-col gap-1">
          <label htmlFor="bpa1-tahun" className="text-xs text-[#6B6B6B]">
            Tahun pajak
          </label>
          <select
            id="bpa1-tahun"
            value={tahun}
            onChange={(e) => setTahun(Number(e.target.value))}
            className={selectClass}
          >
            {opsiTahun.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        {!loading && !loadError && data && (
          <p className="text-xs text-[#9A9A9A] pb-2.5">
            {klien.length} klien · {jumlahDibuat} sudah dibuat · {klien.length - jumlahDibuat} belum dibuat
          </p>
        )}
      </div>

      {loading ? (
        <LoadingState label={`Memuat daftar BPA1 tahun ${tahun}...`} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : klien.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Belum ada klien. Tambahkan klien di Payroll Manager dulu." />
        </div>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Klien</th>
                <th className="px-4 py-3 font-medium">Jumlah Karyawan</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Versi</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {klien.map((k) => {
                const perkiraan = k.sumber_jumlah === 'employees_master';
                return (
                  <tr key={k.client_id} className="border-b border-[#E0E0E0] last:border-0">
                    <td className="px-4 py-3 text-black">{k.nama_perusahaan}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">
                      {perkiraan ? (
                        <span title="Perkiraan dari data karyawan klien. Angka pasti tersedia setelah BPA1 dibuat.">
                          ≈ {k.jumlah_karyawan}
                        </span>
                      ) : (
                        k.jumlah_karyawan
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {k.ada_dokumen ? (
                        <span className="inline-flex items-center gap-2">
                          <span
                            className={`text-[11px] font-medium px-2.5 py-1 ${STATUS_STYLE[k.status] || STATUS_STYLE.Draft}`}
                          >
                            {k.status}
                          </span>
                          {k.is_provisional && (
                            <span className="text-[11px] font-medium px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200">
                              Sementara
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#9A9A9A]">Belum dibuat</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#6B6B6B]">
                      {k.ada_dokumen && k.versi !== null ? `v${k.versi}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {k.ada_dokumen ? (
                        HALAMAN_DETAIL_BPA1_ADA ? (
                          <Link
                            href={hrefDetailBpa1(k.document_id)}
                            className="text-xs text-madael-red hover:text-madael-dark font-medium"
                          >
                            Detail →
                          </Link>
                        ) : (
                          <LabelRedup>Detail segera hadir</LabelRedup>
                        )
                      ) : HALAMAN_BUAT_BPA1_ADA ? (
                        <Link
                          href={hrefBuatBpa1(k.client_id, tahun)}
                          className="inline-block bg-madael-red text-white px-4 py-1.5 text-xs font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors"
                        >
                          Buat
                        </Link>
                      ) : (
                        <LabelRedup>Buat segera hadir</LabelRedup>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {halamanBelumAda.length > 0 && (
        <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#6B6B6B] text-xs px-4 py-3 mt-6">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Daftar ini baru menampilkan status dan versi. Tautan ke {halamanBelumAda.join(' dan ')} belum
          ditampilkan karena halamannya belum tersedia.
        </div>
      )}
    </div>
  );
}
