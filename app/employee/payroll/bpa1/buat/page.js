'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import { todayWib } from '@/lib/wibTime';
import { daftarTahunPilihan, hrefDaftarBpa1, tahunDariQuery } from '@/lib/bpa1Rute';

// Form Buat BPA1 (BPA-07): pilih klien + tahun pajak, lalu POST /api/bpa1
// (BPA-06/09). Server yang membuat dokumen Draft v1 beserta snapshot bulanan
// dari Payroll Run; halaman ini tidak menghitung apa pun dan tidak menyimpan
// data sendiri. Otorisasi sebenarnya di server (requireBpa1Access); guard
// modul 'bpa1' ada di layout.js subtree ini.
//
// Klien dimuat dari data nyata: GET /api/bpa1?tahun= (BPA-04) — daftar yang
// sama dengan halaman Daftar. Klien yang SUDAH punya dokumen di tahun itu
// tampil tetapi tidak bisa dipilih (server menolak dengan 409 bila dipaksa).
//
// Sumber payroll dan penandatangan SENGAJA bukan kontrol form:
//  - sumber payroll: API hanya memiliki satu sumber (Payroll Run, usulan K-06/
//    K-17 yang belum dikonfirmasi) dan POST tidak menerima parameter sumber,
//    jadi dropdown hanya akan berpura-pura memilih — ditampilkan sebagai
//    keterangan baca-saja;
//  - penandatangan: K-16 belum diputuskan; POST tidak menerima dan tidak
//    menulisnya. Bidangnya baru ditambahkan setelah K-16 diputuskan.
//
// ASUMSI (belum diuji terhadap DB nyata): tabel bpa1_* adalah USULAN BPA-01;
// bila belum dimigrasi, pesan 503 dari API ditampilkan apa adanya.

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

// 'YYYY-MM' -> 'Maret'. Format tak dikenal dikembalikan apa adanya.
function namaBulan(periode) {
  const m = /^\d{4}-(\d{2})$/.exec(String(periode || ''));
  const idx = m ? Number(m[1]) - 1 : -1;
  return NAMA_BULAN[idx] || String(periode);
}

function daftarBulan(periodeList) {
  return periodeList.map(namaBulan).join(', ');
}

function Bpa1BuatContent() {
  const searchParams = useSearchParams();
  const [tahunIni] = useState(() => Number(todayWib().slice(0, 4)));
  const opsiTahun = useMemo(() => daftarTahunPilihan(tahunIni), [tahunIni]);

  const [tahun, setTahun] = useState(() => tahunDariQuery(searchParams.get('tahun'), opsiTahun, tahunIni));
  // client_id dari query hanya dipakai bila ada di daftar dan belum punya dokumen.
  const [clientId, setClientId] = useState(() => searchParams.get('client_id') || '');
  const [daftar, setDaftar] = useState(null); // klien untuk `tahun`
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [hasil, setHasil] = useState(null);

  useEffect(() => {
    // Tahun diganti saat permintaan lama masih berjalan: hasil lama dibuang.
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

        if (!res.ok || !Array.isArray(json?.data?.klien)) {
          setDaftar(null);
          setLoadError(
            json.error ||
              (res.ok
                ? 'Gagal memuat daftar klien. Respons server tidak sesuai format yang diharapkan.'
                : 'Gagal memuat daftar klien.')
          );
          return;
        }
        const klien = json.data.klien;
        setDaftar(klien);
        // Pilihan yang tidak lagi valid di tahun ini (hilang / sudah ada dokumen) dikosongkan.
        setClientId((sekarang) => {
          const k = klien.find((x) => x.client_id === sekarang);
          return k && !k.ada_dokumen ? sekarang : '';
        });
      } catch (err) {
        if (err?.name === 'AbortError') return;
        console.error('Muat klien untuk Buat BPA1 error:', err);
        setDaftar(null);
        setLoadError('Gagal memuat daftar klien. Periksa koneksi lalu coba lagi.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    muat();
    return () => controller.abort();
  }, [tahun, reloadKey]);

  const klienDipilih = daftar?.find((k) => k.client_id === clientId) || null;
  const jumlahTersedia = daftar ? daftar.filter((k) => !k.ada_dokumen).length : 0;

  const handleTahunChange = (e) => {
    setTahun(Number(e.target.value));
    setSubmitError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!klienDipilih || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/bpa1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: klienDipilih.client_id, tahun }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.ok && json.success) {
        setHasil({
          klien: klienDipilih.nama_perusahaan,
          tahun,
          versi: json.dokumen?.versi ?? 1,
          status: json.dokumen?.status || 'Draft',
          jumlahItem: json.jumlah_item ?? 0,
          jumlahBaris: json.jumlah_baris_bulanan ?? 0,
          bulan: Array.isArray(json.bulan) ? json.bulan : [],
        });
        return;
      }

      // 400/404/409/500/503: pesan server ditampilkan apa adanya.
      setSubmitError(json.error || 'Gagal membuat BPA1.');
      // Dokumen sudah dibuat admin lain: muat ulang agar klien itu tidak bisa dipilih lagi.
      if (json.code === 'BPA1_SUDAH_ADA') setReloadKey((k) => k + 1);
    } catch (err) {
      console.error('Buat BPA1 error:', err);
      setSubmitError('Gagal membuat BPA1. Periksa koneksi lalu coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectClass =
    'w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors disabled:opacity-50';

  // ── Sukses: tampilkan hasil, lalu kembali ke daftar (tahun yang sama). ──
  if (hasil) {
    const tanpaRun = hasil.bulan.filter((b) => !b.ada_run).map((b) => b.periode);
    const belumApproved = hasil.bulan
      .filter((b) => b.ada_run && b.status_run !== 'Approved')
      .map((b) => b.periode);
    return (
      <div className="max-w-[640px] mx-auto px-6 py-10">
        <div className="bg-white border border-[#E0E0E0] border-t-4 border-t-[#166534] p-6">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={18} className="text-[#166534]" />
            <h1 className="text-base font-semibold text-black">BPA1 berhasil dibuat</h1>
          </div>
          <p className="text-sm text-black mb-4">
            {hasil.klien} — tahun pajak {hasil.tahun}, {hasil.status} v{hasil.versi}.
          </p>
          <ul className="text-sm text-[#6B6B6B] space-y-1 mb-4">
            <li>{hasil.jumlahItem} karyawan masuk ke dokumen.</li>
            <li>{hasil.jumlahBaris} baris bulanan tersalin dari Payroll Run.</li>
            {tanpaRun.length > 0 && <li>Belum ada Payroll Run: {daftarBulan(tanpaRun)}.</li>}
            {belumApproved.length > 0 && <li>Payroll Run belum Approved: {daftarBulan(belumApproved)}.</li>}
          </ul>
          {(tanpaRun.length > 0 || belumApproved.length > 0) && (
            <p className="text-xs text-[#9A9A9A] mb-4">
              Bulan tanpa Payroll Run tidak diisi nol, dan status run disimpan per bulan agar bisa diperiksa
              pada tahap kelengkapan.
            </p>
          )}
          <Link
            href={hrefDaftarBpa1(hasil.tahun)}
            className="inline-block bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors"
          >
            Kembali ke Daftar BPA1
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[640px] mx-auto px-6 py-10">
      <div className="mb-8">
        <Link href={hrefDaftarBpa1(tahun)} className="text-xs text-[#6B6B6B] hover:text-black">
          ← Daftar BPA1
        </Link>
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mt-2">Buat BPA1</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">
          Membuat dokumen BPA1 berstatus Draft v1 untuk satu klien dan tahun pajak.
        </p>
      </div>

      {loadError ? (
        <ErrorState message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : (
        <form onSubmit={handleSubmit} className="bg-white border border-[#E0E0E0] p-6 space-y-5">
          <div>
            <label htmlFor="bpa1-buat-tahun" className="block text-xs text-[#6B6B6B] mb-1">
              Tahun pajak
            </label>
            <select
              id="bpa1-buat-tahun"
              value={tahun}
              onChange={handleTahunChange}
              disabled={submitting}
              className={selectClass}
            >
              {opsiTahun.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="bpa1-buat-klien" className="block text-xs text-[#6B6B6B] mb-1">
              Klien
            </label>
            {loading ? (
              <LoadingState label="Memuat daftar klien..." />
            ) : daftar && daftar.length === 0 ? (
              <EmptyState message="Belum ada klien. Tambahkan klien di Payroll Manager dulu." />
            ) : (
              <>
                <select
                  id="bpa1-buat-klien"
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value);
                    setSubmitError(null);
                  }}
                  disabled={submitting}
                  className={selectClass}
                >
                  <option value="">Pilih klien…</option>
                  {(daftar || []).map((k) => (
                    <option key={k.client_id} value={k.client_id} disabled={k.ada_dokumen}>
                      {k.ada_dokumen
                        ? `${k.nama_perusahaan} — sudah ada (${k.status} v${k.versi})`
                        : k.nama_perusahaan}
                    </option>
                  ))}
                </select>
                {jumlahTersedia === 0 && (
                  <p className="text-xs text-[#9A9A9A] mt-1.5">
                    Semua klien sudah punya BPA1 untuk tahun {tahun}.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="border-t border-[#E0E0E0] pt-4 space-y-3">
            <div>
              <p className="text-xs text-[#6B6B6B] mb-0.5">Sumber payroll</p>
              <p className="text-sm text-black">Payroll Run bulanan (Januari–Desember {tahun})</p>
              <p className="text-xs text-[#9A9A9A] mt-0.5">
                Semua Payroll Run yang ada disalin apa pun statusnya; status run disimpan per bulan. Aturan ini
                masih usulan dan belum dikonfirmasi.
              </p>
            </div>
            <div>
              <p className="text-xs text-[#6B6B6B] mb-0.5">Penandatangan</p>
              <p className="text-xs text-[#9A9A9A]">
                Belum tersedia — menunggu keputusan penandatangan. Bidang ini ditambahkan setelah diputuskan.
              </p>
            </div>
          </div>

          {submitError && (
            <div className="flex items-start justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-3">
              <span className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {submitError}
              </span>
              <button type="button" onClick={() => setSubmitError(null)} className="shrink-0 hover:text-red-900">
                ✕
              </button>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <Link
              href={hrefDaftarBpa1(tahun)}
              className="px-4 py-2 text-sm text-[#6B6B6B] hover:text-black transition-colors"
            >
              Batal
            </Link>
            <button
              type="submit"
              disabled={!klienDipilih || submitting || loading}
              className="bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors disabled:opacity-40"
            >
              {submitting ? 'Membuat...' : 'Buat BPA1'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function Bpa1BuatPage() {
  // useSearchParams perlu batas Suspense (panduan Next.js: prerendering).
  return (
    <Suspense fallback={<LoadingState label="Memuat..." />}>
      <Bpa1BuatContent />
    </Suspense>
  );
}
