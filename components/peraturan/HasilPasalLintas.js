'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import {
  PASAL_LINTAS_GRUP_AWAL, PASAL_LINTAS_PER_PERATURAN,
  kelompokkanPasalLintas, labelPeraturan, pasalAnchor,
} from '@/lib/peraturanConfig';
import { Cuplikan, StatusBadge } from '@/components/peraturan/PeraturanParts';

function GrupPeraturan({ grup }) {
  const [semua, setSemua] = useState(false);
  const tampil = semua ? grup.pasal : grup.pasal.slice(0, PASAL_LINTAS_PER_PERATURAN);
  const sisa = grup.pasal.length - tampil.length;

  return (
    <article className="bg-white border border-[#E0E0E0] p-4">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="text-[11px] font-medium text-madael-red tracking-[0.04em] uppercase">
          {labelPeraturan(grup)}
        </span>
        <StatusBadge status={grup.status} />
      </div>
      <Link
        href={`/employee/peraturan/${grup.id}`}
        className="block text-sm font-medium text-black hover:text-madael-red"
      >
        {grup.judul}
      </Link>

      <ul className="mt-3 space-y-3 border-l-2 border-[#E0E0E0] pl-3">
        {tampil.map((p) => (
          <li key={p.pasal_id}>
            {/* Anchor #pasal-<nomor> dibuka otomatis oleh PasalList di halaman detail. */}
            <Link
              href={`/employee/peraturan/${grup.id}#${pasalAnchor(p.nomor_pasal)}`}
              className="text-sm font-medium text-madael-red hover:text-madael-dark"
            >
              Pasal {p.nomor_pasal}
              {p.judul_pasal ? <span className="font-normal text-[#3D3D3D]"> — {p.judul_pasal}</span> : null}
            </Link>
            <Cuplikan text={p.cuplikan} />
          </li>
        ))}
      </ul>

      {sisa > 0 && (
        <button
          type="button"
          onClick={() => setSemua(true)}
          className="mt-3 text-xs font-medium text-madael-red hover:text-madael-dark"
        >
          Tampilkan {sisa} pasal lainnya
        </button>
      )}
      {semua && grup.pasal.length > PASAL_LINTAS_PER_PERATURAN && (
        <button
          type="button"
          onClick={() => setSemua(false)}
          className="mt-3 text-xs font-medium text-[#6B6B6B] hover:text-black"
        >
          Ringkas
        </button>
      )}
    </article>
  );
}

// Seksi "Cocok di dalam pasal" di atas daftar peraturan. Berdiri sendiri (tidak ikut
// paginasi daftar) dan non-fatal: kegagalan hanya menampilkan pesan kecil + coba lagi,
// daftar peraturan di bawahnya tetap berfungsi.
// rows: baris mentah RPC cari_pasal_lintas; ready: hasil sudah sesuai pencarian/filter aktif.
export default function HasilPasalLintas({ rows, ready, error, onRetry }) {
  const [semuaGrup, setSemuaGrup] = useState(false);
  const grup = useMemo(() => kelompokkanPasalLintas(rows), [rows]);

  if (!ready && !error) {
    return <p className="text-xs text-[#9A9A9A] mb-4">Mencari di dalam isi pasal...</p>;
  }
  if (error) {
    return (
      <p role="alert" className="text-xs text-red-600 mb-4">
        {error}{' '}
        <button type="button" onClick={onRetry} className="underline font-medium">
          Coba lagi
        </button>
      </p>
    );
  }
  if (grup.length === 0) return null;

  const totalPasal = Number(rows[0]?.total_cocok) || rows.length;
  const terpotong = totalPasal > rows.length;
  const tampil = semuaGrup ? grup : grup.slice(0, PASAL_LINTAS_GRUP_AWAL);

  return (
    <section className="mb-6" aria-label="Hasil pencarian di dalam pasal">
      <div className="flex items-center gap-2 mb-1">
        <BookOpen size={15} className="text-madael-red" aria-hidden="true" />
        <h2 className="text-sm font-medium text-black">Cocok di dalam pasal</h2>
      </div>
      <p className="text-xs text-[#6B6B6B] mb-3">
        {totalPasal} pasal di {grup.length} peraturan
        {terpotong && ` — menampilkan ${rows.length} teratas, persempit pencarian atau filter untuk melihat sisanya`}
      </p>

      <div className="space-y-3">
        {tampil.map((g) => <GrupPeraturan key={g.id} grup={g} />)}
      </div>

      {grup.length > PASAL_LINTAS_GRUP_AWAL && (
        <button
          type="button"
          onClick={() => setSemuaGrup((v) => !v)}
          className="mt-3 text-xs font-medium text-madael-red hover:text-madael-dark"
        >
          {semuaGrup ? 'Ringkas' : `Tampilkan ${grup.length - PASAL_LINTAS_GRUP_AWAL} peraturan lainnya`}
        </button>
      )}
    </section>
  );
}
