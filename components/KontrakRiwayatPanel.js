'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatTanggalKepegawaian, JENIS_DENGAN_AKHIR_KONTRAK } from '@/lib/kepegawaian';
import { durasiPeriode, formatDurasi, kontrakEfektif, ringkasanDurasi, tautanKalkulatorPkwt } from '@/lib/kontrakRiwayat';
import KontrakPerpanjangModal from '@/components/KontrakPerpanjangModal';

const STATUS_STYLE = {
  aman: 'bg-[#DCFCE7] text-[#166534]',
  mendekati: 'bg-amber-50 text-amber-800',
  melewati: 'bg-red-50 text-red-700',
};

// Panel "Riwayat Kontrak" di detail karyawan (Employee List). Menampilkan
// kontrak-kontrak PKWT/Magang, total masa kumulatif beserta peringatan batas
// durasi, tombol Perpanjang Kontrak, dan tautan Hitung Kompensasi (Kalkulator
// PKWT dengan tanggal terisi).
//
// Props:
// - masterId: id employees_master (null/undefined -> panel tidak tampil).
// - reloadKey: naikkan nilainya untuk memuat ulang (mis. setelah edit karyawan).
// - onChanged: dipanggil setelah perpanjangan tersimpan, supaya halaman induk
//   memuat ulang tanggal berakhir di kartu HR & Payroll.
export default function KontrakRiwayatPanel({ masterId, reloadKey = 0, onChanged }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [localKey, setLocalKey] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!masterId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/payroll/master/${masterId}/contracts`, { cache: 'no-store' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Gagal memuat riwayat kontrak.');
        if (!cancelled) setState({ status: 'ready', data: body, error: null });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', data: null, error: err.message || 'Gagal memuat riwayat kontrak.' });
      }
    })();
    return () => { cancelled = true; };
  }, [masterId, reloadKey, localKey]);

  const handleDone = useCallback(() => {
    setModalOpen(false);
    setLocalKey((k) => k + 1);
    onChanged?.();
  }, [onChanged]);

  if (!masterId) return null;
  const { status, data, error } = state;

  const master = data?.master;
  const jenis = master?.jenis_hubungan_kerja;
  const adaJenis = JENIS_DENGAN_AKHIR_KONTRAK.includes(jenis);
  const contracts = data?.contracts || [];

  // PKWTT tanpa riwayat: tidak ada yang ditampilkan.
  if (status === 'ready' && !adaJenis && contracts.length === 0) return null;

  const efektif = status === 'ready' ? kontrakEfektif(contracts, master) : [];
  const ringkasan = status === 'ready' && adaJenis ? ringkasanDurasi(efektif, jenis) : null;
  const terakhir = efektif.length ? efektif[efektif.length - 1] : null;
  const dariRiwayat = contracts.length > 0;
  // Tanggal berakhir di data kepegawaian diubah lewat form edit, bukan lewat
  // tombol Perpanjang: riwayat jadi tidak sama dengan data kepegawaian.
  const tidakSinkron = dariRiwayat && master?.kontrak_berakhir && terakhir && master.kontrak_berakhir !== terakhir.tanggal_berakhir;

  return (
    <div className="bg-white border border-[#E0E0E0] p-5 mt-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold text-black tracking-[0.02em] mb-1">Riwayat Kontrak</p>
          {ringkasan && ringkasan.status !== 'none' && (
            <p className="text-sm text-[#6B6B6B]">
              Total masa {jenis}: <span className="text-black">{formatDurasi(ringkasan.total)}</span>
            </p>
          )}
        </div>
        {status === 'ready' && adaJenis && (
          <div className="flex items-center gap-3 flex-wrap">
            {jenis === 'PKWT' && terakhir && (
              <Link href={tautanKalkulatorPkwt(terakhir)} className="text-xs text-madael-red hover:text-madael-dark font-medium whitespace-nowrap">
                Hitung Kompensasi
              </Link>
            )}
            {data.canExtend && (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="px-3 py-1.5 text-xs font-medium text-white bg-madael-red hover:bg-madael-dark transition-colors cursor-pointer border-0"
              >
                Perpanjang Kontrak
              </button>
            )}
          </div>
        )}
      </div>

      {status === 'loading' && <p className="text-sm text-[#6B6B6B]">Memuat riwayat kontrak...</p>}
      {status === 'error' && <p className="text-sm text-madael-red">{error}</p>}

      {status === 'ready' && (
        <>
          {ringkasan && ringkasan.status !== 'none' && (
            <div className="mb-4 space-y-2">
              <span className={`inline-block text-xs font-medium px-2.5 py-1 ${STATUS_STYLE[ringkasan.status]}`}>{ringkasan.label}</span>
              {ringkasan.status !== 'aman' && (
                <p className="text-xs text-[#6B6B6B]">
                  Batas {jenis} menurut {ringkasan.dasar}. Angka batas perlu divalidasi tim legal Madael.
                </p>
              )}
            </div>
          )}

          {tidakSinkron && (
            <p className="mb-4 text-xs text-amber-800 bg-amber-50 px-3 py-2">
              Tanggal berakhir di data kepegawaian ({formatTanggalKepegawaian(master.kontrak_berakhir)}) tidak sama dengan kontrak terakhir di riwayat ({formatTanggalKepegawaian(terakhir.tanggal_berakhir)}). Kemungkinan diubah lewat form Edit. Gunakan Perpanjang Kontrak agar riwayat tetap lengkap.
            </p>
          )}

          {efektif.length === 0 ? (
            <p className="text-sm text-[#6B6B6B]">Belum ada riwayat kontrak. Isi tanggal bergabung dan tanggal berakhir, atau gunakan Perpanjang Kontrak.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[#6B6B6B]">
                    <th className="font-medium pb-2 pr-4">Jenis</th>
                    <th className="font-medium pb-2 pr-4">Periode</th>
                    <th className="font-medium pb-2 pr-4">Durasi</th>
                    <th className="font-medium pb-2">Nomor / Catatan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F0F0]">
                  {[...efektif].reverse().map((c, i) => {
                    const d = durasiPeriode(c.tanggal_mulai, c.tanggal_berakhir);
                    return (
                      <tr key={c.id || `perkiraan-${i}`} className="align-top">
                        <td className="py-2 pr-4 text-black whitespace-nowrap">{c.jenis}</td>
                        <td className="py-2 pr-4 text-black whitespace-nowrap">
                          {formatTanggalKepegawaian(c.tanggal_mulai)} – {formatTanggalKepegawaian(c.tanggal_berakhir)}
                        </td>
                        <td className="py-2 pr-4 text-[#6B6B6B] whitespace-nowrap">{d ? formatDurasi(d) : '-'}</td>
                        <td className="py-2 text-[#6B6B6B]">
                          {c.perkiraan
                            ? 'Perkiraan dari tanggal bergabung (riwayat belum tercatat).'
                            : [c.nomor_kontrak, c.catatan].filter(Boolean).join(' · ') || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {modalOpen && <KontrakPerpanjangModal masterId={masterId} onClose={() => setModalOpen(false)} onDone={handleDone} />}
    </div>
  );
}
