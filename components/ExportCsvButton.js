'use client';

// Tombol kecil reusable buat export satu tabel/chart data ke CSV. Dipasang
// di header tiap section Reports/Statistics — sengaja per-section (bukan
// satu tombol "export semua") supaya file yang didownload jelas isinya apa.
//
// Dua mode:
// - `rows`     : data sudah ada di state halaman (Reports, Statistics, Absensi).
// - `loadRows` : fungsi async yang mengambil data LENGKAP saat tombol diklik,
//                dipakai halaman berdaftar-berhalaman (Kelola Cuti, Lembur,
//                Reimbursement, Slip) supaya file berisi seluruh data sesuai
//                filter aktif, bukan hanya halaman yang sedang tampil.
//                Kembalian: { rows, error } — `error` berupa teks pesan.
//                Dengan `loadRows`, tombol nonaktif lewat prop `disabled`.
// `neutralizeFormulas` meneruskan opsi downloadCsv (lihat lib/exportCsv.js);
// aktifkan untuk kolom teks bebas dari pengguna (nama, alasan, deskripsi).

import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadCsv } from '@/lib/exportCsv';

export default function ExportCsvButton({
  filename,
  headers,
  rows,
  loadRows,
  disabled: disabledProp = false,
  neutralizeFormulas = false,
  label = 'Export CSV',
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const disabled = busy || disabledProp || (!loadRows && (!rows || rows.length === 0));

  const handleClick = async () => {
    if (!loadRows) {
      downloadCsv(filename, headers, rows, { neutralizeFormulas });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await loadRows();
      if (result?.error) {
        setError(result.error);
        return;
      }
      if (!result?.rows || result.rows.length === 0) {
        setError('Tidak ada data untuk diekspor.');
        return;
      }
      downloadCsv(filename, headers, result.rows, { neutralizeFormulas });
    } catch {
      setError('Gagal mengekspor data. Periksa koneksi internet kamu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2 shrink-0 print:hidden">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-madael-red hover:text-madael-dark disabled:opacity-40 disabled:cursor-not-allowed print:hidden shrink-0"
      >
        <Download size={13} /> {busy ? 'Menyiapkan...' : label}
      </button>
      {error && <span className="text-xs text-madael-red">{error}</span>}
    </span>
  );
}
