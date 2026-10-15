'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { logActivity } from '@/lib/activityLogClient';
import { friendlyError } from '@/lib/errorMessage';
import { fetchAllRows } from '@/lib/fetchAllRows';
import {
  IMPORT_COLUMNS, IMPORT_LIMITS, JENIS_OPTIONS, STATUS_OPTIONS, TOPIK_OPTIONS,
  mapImportHeader, validateImportRow, kunciPeraturan, formatUkuranBerkas,
} from '@/lib/peraturanConfig';
import ConfirmDialog from '@/components/ConfirmDialog';
import { labelClass } from '@/components/peraturan/PeraturanParts';

const TEMPLATE_FILENAME = 'template-impor-peraturan.xlsx';
const BARIS_STYLE = {
  siap: 'bg-green-100 text-green-700',
  duplikat: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
};
const BARIS_LABEL = { siap: 'Siap', duplikat: 'Duplikat', error: 'Error' };

// Kode error yang membuat sisa impor tidak ada gunanya dilanjutkan
// (tidak punya izin, sesi habis, atau koneksi putus -> error tanpa kode).
function isFatal(err) {
  return !err?.code || ['42501', 'PGRST301', 'PGRST303'].includes(String(err.code));
}

function isEmptyRow(cells) {
  return (cells || []).every((c) => c == null || String(c).trim() === '');
}

function rawText(cells, index, key) {
  if (!(key in index)) return '';
  const v = cells[index[key]];
  return v == null ? '' : String(v).trim();
}

// Template: sheet "Data" (hanya header) + sheet "Petunjuk". Contoh di sheet
// Petunjuk fiktif dan berjudul "CONTOH - HAPUS" (ditolak importer bila ikut terisi).
async function unduhTemplate() {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const data = XLSX.utils.aoa_to_sheet([IMPORT_COLUMNS.map((c) => (c.required ? `${c.header} *` : c.header))]);
  data['!cols'] = IMPORT_COLUMNS.map((c) => ({ wch: Math.max(14, c.header.length + 6) }));
  XLSX.utils.book_append_sheet(wb, data, 'Data');

  const contoh = {
    jenis: 'PP', nomor: '999', tahun: '2099', judul: 'CONTOH - HAPUS: judul fiktif', tentang: 'contoh saja, bukan isi hukum',
    tanggal_ditetapkan: '2099-01-31', tanggal_berlaku: '2099-02-01', status: 'Berlaku', topik: 'PKWT;Upah',
    keywords: 'contoh, fiktif', ringkasan: '', url_sumber: 'https://contoh.example/sumber', url_pdf: '',
  };
  const petunjuk = [
    ['Petunjuk pengisian (sheet ini tidak ikut diimpor)'],
    [''],
    ['Isi data di sheet "Data", mulai baris 2. Baris 1 (header) jangan diubah. Kolom bertanda * wajib diisi.'],
    [`Maksimal ${IMPORT_LIMITS.maxRows} baris dan ${formatUkuranBerkas(IMPORT_LIMITS.maxBytes)} per file. Format: .xlsx, .xls, atau .csv.`],
    ['Impor hanya MENAMBAH peraturan baru. Peraturan yang sama (jenis + nomor + tahun) dilewati, tidak ditimpa.'],
    [`Jenis: ${JENIS_OPTIONS.join(', ')}`],
    [`Status (kosong = Berlaku): ${STATUS_OPTIONS.join(', ')}`],
    [`Topik: pisahkan dengan titik koma (;). Pilihan: ${TOPIK_OPTIONS.join(', ')}. Topik lain dilewati dengan peringatan.`],
    ['Keyword: pisahkan dengan koma (,).'],
    ['Tanggal: YYYY-MM-DD atau DD/MM/YYYY (hari/bulan/tahun), atau sel tanggal Excel.'],
    ['Nomor dengan nol di depan (mis. 035) dianggap sama dengan 35 saat cek duplikat.'],
    ['Isi konten hukum harus dari sumber resmi. Template ini tidak berisi data peraturan asli.'],
    [''],
    ['Contoh baris (fiktif; baris berjudul "CONTOH..." akan ditolak importer):'],
    IMPORT_COLUMNS.map((c) => c.header),
    IMPORT_COLUMNS.map((c) => contoh[c.key] ?? ''),
  ];
  const sheetPetunjuk = XLSX.utils.aoa_to_sheet(petunjuk);
  sheetPetunjuk['!cols'] = [{ wch: 28 }, ...IMPORT_COLUMNS.slice(1).map(() => ({ wch: 24 }))];
  XLSX.utils.book_append_sheet(wb, sheetPetunjuk, 'Petunjuk');

  XLSX.writeFile(wb, TEMPLATE_FILENAME);
}

// Baca file -> { header, dataRows: [{ rowNo, cells }] } (rowNo = nomor baris di file).
async function bacaFile(file) {
  const XLSX = await import('xlsx');
  const name = file.name.toLowerCase();
  let wb;
  if (name.endsWith('.csv')) {
    const text = (await file.text()).replace(/^\uFEFF/, '');
    wb = XLSX.read(text, { type: 'string' });
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  }
  const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === 'data') || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return { header: [], dataRows: [] };
  // header:1 + raw:true -> array sel apa adanya; nomor baris tetap sama dengan di Excel.
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: true });
  const [header = [], ...rest] = grid;
  const dataRows = rest
    .map((cells, i) => ({ rowNo: i + 2, cells }))
    .filter((r) => !isEmptyRow(r.cells));
  return { header, dataRows };
}

export default function PeraturanImport({ employee }) {
  const supabase = createClient();
  const fileInputRef = useRef(null);

  const [stage, setStage] = useState('pilih'); // pilih | pratinjau | proses | selesai
  const [fileName, setFileName] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [soloMasalah, setSoloMasalah] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);

  // Peringatan bawaan browser selama impor berjalan (jangan tutup tab di tengah proses).
  useEffect(() => {
    if (stage !== 'proses') return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [stage]);

  const counts = useMemo(() => {
    const c = { total: rows.length, siap: 0, duplikat: 0, error: 0, peringatan: 0 };
    rows.forEach((r) => {
      c[r.status] += 1;
      if (r.status === 'siap' && r.warnings.length > 0) c.peringatan += 1;
    });
    return c;
  }, [rows]);

  const tampil = useMemo(
    () => (soloMasalah ? rows.filter((r) => r.status !== 'siap' || r.warnings.length > 0) : rows),
    [rows, soloMasalah]
  );

  const reset = () => {
    setStage('pilih');
    setFileName('');
    setError('');
    setRows([]);
    setResult(null);
    setSoloMasalah(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleTemplate = async () => {
    setError('');
    try {
      await unduhTemplate();
    } catch {
      setError('Gagal membuat template. Coba lagi.');
    }
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setRows([]);
    setStage('pilih');

    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setError('Format file harus .xlsx, .xls, atau .csv.');
      return;
    }
    if (file.size > IMPORT_LIMITS.maxBytes) {
      setError(`Ukuran file maksimal ${formatUkuranBerkas(IMPORT_LIMITS.maxBytes)}.`);
      return;
    }

    setFileName(file.name);
    setParsing(true);
    try {
      const { header, dataRows } = await bacaFile(file);
      const { index, missing } = mapImportHeader(header);
      if (missing.length > 0) {
        setError(`Kolom wajib tidak ditemukan di baris 1: ${missing.join(', ')}. Pakai template yang disediakan.`);
        return;
      }
      if (dataRows.length === 0) {
        setError('Tidak ada baris data yang terbaca. Isi data mulai baris 2.');
        return;
      }
      if (dataRows.length > IMPORT_LIMITS.maxRows) {
        setError(`File berisi ${dataRows.length} baris. Maksimal ${IMPORT_LIMITS.maxRows} baris per impor; pecah file menjadi beberapa bagian.`);
        return;
      }

      // Peraturan yang sudah ada, untuk cek duplikat sebelum insert.
      const { data: existing, error: existErr } = await fetchAllRows(() =>
        supabase.from('peraturan').select('jenis, nomor, tahun')
      );
      if (existErr) {
        setError(friendlyError(existErr, 'Gagal memeriksa peraturan yang sudah ada.', { context: 'Impor peraturan' }));
        return;
      }
      const dbKeys = new Set((existing || []).map((r) => kunciPeraturan(r.jenis, r.nomor, r.tahun)));
      const dalamFile = new Map(); // kunci -> nomor baris pertama

      const analyzed = dataRows.map(({ rowNo, cells }) => {
        const v = validateImportRow(cells, index);
        const label = [rawText(cells, index, 'jenis'), rawText(cells, index, 'nomor') && `No. ${rawText(cells, index, 'nomor')}`, rawText(cells, index, 'tahun') && `Tahun ${rawText(cells, index, 'tahun')}`]
          .filter(Boolean)
          .join(' ');
        const base = { rowNo, label, judul: rawText(cells, index, 'judul'), payload: v.payload, warnings: v.warnings };
        if (v.errors.length > 0) return { ...base, status: 'error', notes: v.errors };

        const key = kunciPeraturan(v.payload.jenis, v.payload.nomor, v.payload.tahun);
        if (dbKeys.has(key)) {
          return { ...base, status: 'duplikat', notes: ['Sudah ada di database; dilewati (tidak ditimpa).'] };
        }
        if (dalamFile.has(key)) {
          return { ...base, status: 'duplikat', notes: [`Sama dengan baris ${dalamFile.get(key)} di file ini; dilewati.`] };
        }
        dalamFile.set(key, rowNo);
        return { ...base, status: 'siap', notes: [] };
      });

      setRows(analyzed);
      setStage('pratinjau');
    } catch {
      setError('Gagal membaca file. Pastikan formatnya sesuai template dan tidak rusak.');
    } finally {
      setParsing(false);
    }
  };

  const jalankanImpor = async () => {
    setConfirmOpen(false);
    const todo = rows.filter((r) => r.status === 'siap');
    if (todo.length === 0) return;

    setStage('proses');
    setProgress({ done: 0, total: todo.length });

    let berhasil = 0;
    let dilewati = rows.filter((r) => r.status === 'duplikat').length;
    const gagal = rows
      .filter((r) => r.status === 'error')
      .map((r) => ({ rowNo: r.rowNo, label: r.label, pesan: r.notes.join(' ') }));
    const diproses = new Set();
    let berhenti = false;

    for (let i = 0; i < todo.length && !berhenti; i += IMPORT_LIMITS.batchSize) {
      const batch = todo.slice(i, i + IMPORT_LIMITS.batchSize);
      const { error: batchErr } = await supabase.from('peraturan').insert(batch.map((r) => r.payload));

      if (!batchErr) {
        berhasil += batch.length;
        batch.forEach((r) => diproses.add(r.rowNo));
      } else {
        // Batch ditolak seluruhnya (satu statement): ulangi per baris untuk
        // memisahkan duplikat (23505) dari baris yang benar-benar gagal.
        for (const r of batch) {
          if (berhenti) break;
          const { error: rowErr } = await supabase.from('peraturan').insert([r.payload]);
          diproses.add(r.rowNo);
          if (!rowErr) {
            berhasil += 1;
          } else if (rowErr.code === '23505') {
            dilewati += 1;
          } else {
            gagal.push({
              rowNo: r.rowNo,
              label: r.label,
              pesan: friendlyError(rowErr, 'Gagal menyimpan baris ini.', { context: 'Impor peraturan' }),
            });
            if (isFatal(rowErr)) berhenti = true;
          }
        }
      }
      setProgress({ done: Math.min(i + batch.length, todo.length), total: todo.length });
    }

    todo.filter((r) => !diproses.has(r.rowNo)).forEach((r) => {
      gagal.push({ rowNo: r.rowNo, label: r.label, pesan: 'Tidak diproses karena impor dihentikan (izin, sesi, atau koneksi bermasalah).' });
    });
    gagal.sort((a, b) => a.rowNo - b.rowNo);

    // Satu entri log per impor (bukan per baris) supaya Activity Log tidak banjir.
    logActivity({
      aksi: 'impor_peraturan_massal',
      targetTable: 'peraturan',
      targetId: null,
      detail: { nama_file: fileName, total: rows.length, berhasil, dilewati, gagal: gagal.length },
    });

    setResult({ berhasil, dilewati, gagal });
    setStage('selesai');
  };

  // ---------------------------------------------------------------------
  // Tampilan
  // ---------------------------------------------------------------------

  if (stage === 'selesai' && result) {
    return (
      <div className="bg-white border border-[#E0E0E0] border-t-4 border-t-madael-red p-6 md:p-8">
        <h2 className="text-lg font-semibold text-black mb-1">Impor selesai</h2>
        <p className="text-xs text-[#6B6B6B] mb-5">{fileName}</p>
        <div className="grid grid-cols-3 gap-3 mb-5">
          <Ringkasan label="Berhasil ditambah" value={result.berhasil} tone="text-green-700" />
          <Ringkasan label="Dilewati (duplikat)" value={result.dilewati} tone="text-amber-700" />
          <Ringkasan label="Gagal" value={result.gagal.length} tone="text-red-600" />
        </div>
        {result.gagal.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-medium text-[#6B6B6B] mb-2">Baris yang gagal (perbaiki lalu impor ulang; baris yang sudah masuk akan dilewati sebagai duplikat):</p>
            <ul className="max-h-60 overflow-auto border border-[#E0E0E0] divide-y divide-[#F0F0F0] text-xs">
              {result.gagal.map((g) => (
                <li key={g.rowNo} className="px-3 py-2">
                  <span className="font-medium text-black">Baris {g.rowNo}</span>
                  {g.label && <span className="text-[#6B6B6B]"> — {g.label}</span>}
                  <p className="text-red-600">{g.pesan}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Link
            href="/employee/peraturan"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Lihat Daftar Peraturan
          </Link>
          <button
            type="button"
            onClick={reset}
            className="px-6 py-2.5 text-sm font-medium border border-[#E0E0E0] bg-white text-black hover:bg-[#F4F4F4]"
          >
            Impor File Lain
          </button>
        </div>
      </div>
    );
  }

  const memproses = stage === 'proses';

  return (
    <div className="space-y-5">
      <div className="bg-white border border-[#E0E0E0] border-t-4 border-t-madael-red p-6 md:p-8">
        <p className="text-sm text-black mb-2">
          Impor banyak peraturan sekaligus dari file Excel atau CSV. Impor hanya <strong>menambah</strong> peraturan baru;
          peraturan yang sudah ada (jenis + nomor + tahun sama) dilewati dan tidak ditimpa. Pasal dan berkas PDF tidak ikut
          diimpor.
        </p>
        <p className="text-xs text-[#6B6B6B] mb-4">
          Maksimal {IMPORT_LIMITS.maxRows} baris dan {formatUkuranBerkas(IMPORT_LIMITS.maxBytes)} per file.
        </p>
        <button
          type="button"
          onClick={handleTemplate}
          className="inline-flex items-center gap-2 text-sm text-madael-red hover:text-madael-dark font-medium mb-5"
        >
          <Download size={15} />
          Unduh Template Excel
        </button>

        <div>
          <label className={labelClass} htmlFor="file-impor-peraturan">File (.xlsx, .xls, .csv)</label>
          <input
            id="file-impor-peraturan"
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFile}
            disabled={parsing || memproses}
            className="w-full text-sm text-black file:mr-3 file:px-4 file:py-2 file:border-0 file:bg-madael-red file:text-white file:text-sm file:font-medium hover:file:bg-madael-dark file:cursor-pointer cursor-pointer disabled:opacity-60"
          />
        </div>
        {parsing && <p className="mt-3 text-sm text-[#6B6B6B]">Membaca dan memeriksa file...</p>}
        {error && <p className="mt-3 text-sm text-madael-red">{error}</p>}
      </div>

      {stage !== 'pilih' && rows.length > 0 && (
        <div className="bg-white border border-[#E0E0E0] p-6">
          <h2 className="text-base font-semibold text-black mb-1">Pratinjau</h2>
          <p className="text-xs text-[#6B6B6B] mb-4">{fileName}</p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Ringkasan label="Total baris" value={counts.total} tone="text-black" />
            <Ringkasan label="Siap diimpor" value={counts.siap} tone="text-green-700" hint={counts.peringatan ? `${counts.peringatan} dengan peringatan` : ''} />
            <Ringkasan label="Duplikat (dilewati)" value={counts.duplikat} tone="text-amber-700" />
            <Ringkasan label="Error (tidak diimpor)" value={counts.error} tone="text-red-600" />
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-[#3D3D3D] mb-3 cursor-pointer">
            <input type="checkbox" checked={soloMasalah} onChange={(e) => setSoloMasalah(e.target.checked)} />
            Tampilkan hanya baris bermasalah (error, duplikat, peringatan)
          </label>

          <div className="max-h-[480px] overflow-auto border border-[#E0E0E0]">
            <table className="w-full text-xs">
              <thead className="bg-[#F4F4F4] text-left text-[#6B6B6B] sticky top-0">
                <tr>
                  <th className="px-3 py-2 font-medium">Baris</th>
                  <th className="px-3 py-2 font-medium">Peraturan</th>
                  <th className="px-3 py-2 font-medium">Judul</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F0]">
                {tampil.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-[#6B6B6B]">Tidak ada baris bermasalah.</td></tr>
                )}
                {tampil.map((r) => (
                  <tr key={r.rowNo} className="align-top">
                    <td className="px-3 py-2 text-[#6B6B6B]">{r.rowNo}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-black">{r.label || '-'}</td>
                    <td className="px-3 py-2 text-black max-w-[260px] truncate" title={r.judul}>{r.judul || '-'}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-medium tracking-[0.04em] px-2 py-0.5 uppercase ${BARIS_STYLE[r.status]}`}>
                        {BARIS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {r.notes.map((n, i) => <p key={`n${i}`} className={r.status === 'error' ? 'text-red-600' : 'text-[#3D3D3D]'}>{n}</p>)}
                      {r.warnings.map((w, i) => <p key={`w${i}`} className="text-amber-700">⚠ {w}</p>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {memproses && (
            <p className="mt-4 text-sm text-[#6B6B6B]">
              Mengimpor... {progress.done} dari {progress.total} baris. Jangan tutup halaman ini.
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={counts.siap === 0 || memproses}
              className="inline-flex items-center gap-2 bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Upload size={15} />
              {counts.siap === 0 ? 'Tidak ada baris yang bisa diimpor' : `Impor ${counts.siap} Peraturan`}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={memproses}
              className="px-6 py-2.5 text-sm font-medium border border-[#E0E0E0] bg-white text-black hover:bg-[#F4F4F4] disabled:opacity-60"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Impor Peraturan"
        message={
          <>
            <strong>{counts.siap}</strong> peraturan baru akan ditambahkan.
            {counts.duplikat + counts.error > 0 && <> {counts.duplikat + counts.error} baris lain (duplikat/error) tidak diimpor.</>}
            {' '}Peraturan yang sudah ada tidak diubah. Lanjutkan?
          </>
        }
        confirmLabel="Ya, Impor"
        onConfirm={jalankanImpor}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

function Ringkasan({ label, value, tone, hint }) {
  return (
    <div className="border border-[#E0E0E0] bg-[#FAFAFA] px-4 py-3">
      <p className="text-[11px] text-[#6B6B6B]">{label}</p>
      <p className={`text-2xl font-semibold ${tone}`}>{value}</p>
      {hint && <p className="text-[11px] text-amber-700">{hint}</p>}
    </div>
  );
}
