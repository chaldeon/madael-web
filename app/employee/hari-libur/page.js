'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, Upload, X, AlertTriangle } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { tahunSekarang } from '@/lib/leave';
import {
  JENIS_LIBUR, JENIS_LIBUR_LIST, MAKS_NAMA_LIBUR, MAKS_BARIS_IMPOR_LIBUR,
  TAHUN_LIBUR_MIN, TAHUN_LIBUR_MAX,
  formatTanggalLibur, labelJenisLibur, parseImporLibur, tanggalLiburValid, tahunLiburWajar,
} from '@/lib/publicHolidays';

const inputClass =
  'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors w-full';

const CONTOH_IMPOR = `# tanggal; nama libur; jenis (nasional / cuti bersama, boleh dikosongkan = nasional)
# Salin dari SKB 3 Menteri tahun yang bersangkutan, bukan dari memori.
2027-01-01; Tahun Baru Masehi; nasional`;

// Panggil API hari libur. Return { ok, data } atau { ok: false, error, status }.
async function callApi(path, method, body) {
  try {
    const res = await fetch(`/api/public-holidays${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, status: res.status, error: data?.error || 'Permintaan gagal. Silakan coba lagi.', data };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Koneksi bermasalah. Periksa internet kamu lalu coba lagi.' };
  }
}

function JenisBadge({ jenis }) {
  const cls = jenis === 'cuti_bersama' ? 'bg-amber-100 text-amber-800' : 'bg-red-50 text-madael-red';
  return <span className={`text-[10px] font-medium tracking-[0.04em] px-2 py-1 ${cls}`}>{labelJenisLibur(jenis).toUpperCase()}</span>;
}

export default function HariLiburPage() {
  const [tahun, setTahun] = useState(() => tahunSekarang());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [listMsg, setListMsg] = useState(null); // { type: 'ok' | 'error', text }

  // Form tambah / edit
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // baris yang diedit, null = tambah baru
  const EMPTY_FORM = useMemo(() => ({ tanggal: `${tahun}-01-01`, nama: '', jenis: 'nasional' }), [tahun]);
  const [form, setForm] = useState({ tanggal: '', nama: '', jenis: 'nasional' });
  const [baseline, setBaseline] = useState({ tanggal: '', nama: '', jenis: 'nasional' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  // Hapus
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Impor
  const [showImpor, setShowImpor] = useState(false);
  const [imporTeks, setImporTeks] = useState('');
  const [imporSaving, setImporSaving] = useState(false);
  const [imporError, setImporError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await callApi(`?year=${tahun}`, 'GET');
    if (!res.ok) {
      setLoadError(res.error);
      setLoading(false);
      return;
    }
    setRows(res.data.rows || []);
    setLoading(false);
  }, [tahun]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const closeForm = () => setShowForm(false);
  const closeImpor = () => setShowImpor(false);
  const handleFormBackdrop = useModalDismiss(showForm, closeForm, undefined, JSON.stringify(form) !== JSON.stringify(baseline));
  const handleImporBackdrop = useModalDismiss(showImpor, closeImpor, undefined, imporTeks.trim() !== '');

  const openAdd = () => {
    setEditing(null);
    setBaseline(EMPTY_FORM);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (row) => {
    const initial = { tanggal: row.tanggal, nama: row.nama, jenis: row.jenis };
    setEditing(row);
    setBaseline(initial);
    setForm(initial);
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    const nama = form.nama.trim();
    if (!editing) {
      if (!tanggalLiburValid(form.tanggal)) return setFormError('Tanggal wajib diisi dengan benar.');
      if (!tahunLiburWajar(form.tanggal)) return setFormError(`Tahun harus antara ${TAHUN_LIBUR_MIN} dan ${TAHUN_LIBUR_MAX}.`);
    }
    if (!nama) return setFormError('Nama libur wajib diisi.');
    if (nama.length > MAKS_NAMA_LIBUR) return setFormError(`Nama libur maksimal ${MAKS_NAMA_LIBUR} karakter.`);

    setSaving(true);
    setFormError(null);
    const res = editing
      ? await callApi(`/${encodeURIComponent(editing.id)}`, 'PATCH', { nama, jenis: form.jenis })
      : await callApi('', 'POST', { items: [{ tanggal: form.tanggal, nama, jenis: form.jenis }] });
    setSaving(false);
    if (!res.ok) {
      setFormError(res.error);
      return;
    }

    setShowForm(false);
    setListMsg({ type: 'ok', text: editing ? `"${nama}" diperbarui.` : `"${nama}" ditambahkan.` });
    // Tanggal yang ditambah bisa di tahun lain: pindah ke tahun itu.
    if (!editing && Number(form.tanggal.slice(0, 4)) !== tahun) {
      setTahun(Number(form.tanggal.slice(0, 4)));
    } else {
      await load();
    }
  };

  const executeDelete = async (row) => {
    setDeleting(true);
    const res = await callApi(`/${encodeURIComponent(row.id)}`, 'DELETE');
    setDeleting(false);
    if (!res.ok) {
      setListMsg({ type: 'error', text: res.error });
      if (res.status === 404) await load();
      return;
    }
    setListMsg({ type: 'ok', text: `"${row.nama}" (${row.tanggal}) dihapus.` });
    await load();
  };

  const imporPratinjau = useMemo(() => parseImporLibur(imporTeks), [imporTeks]);

  const handleImpor = async () => {
    const { items, errors } = imporPratinjau;
    if (errors.length > 0) return setImporError('Perbaiki baris yang bermasalah dulu (lihat daftar di bawah).');
    if (items.length === 0) return setImporError('Belum ada baris yang bisa diimpor.');

    setImporSaving(true);
    setImporError(null);
    const res = await callApi('', 'POST', { items: items.map(({ tanggal, nama, jenis }) => ({ tanggal, nama, jenis })) });
    setImporSaving(false);
    if (!res.ok) {
      setImporError(res.error);
      return;
    }

    const { ditambah, dilewati } = res.data;
    setShowImpor(false);
    setImporTeks('');
    setListMsg({
      type: 'ok',
      text: `${ditambah} hari libur ditambahkan${dilewati?.length ? `; ${dilewati.length} tanggal sudah ada dan dilewati (tidak ditimpa)` : ''}.`,
    });
    await load();
  };

  const nasionalCount = rows.filter((r) => r.jenis === 'nasional').length;
  const cutiBersamaCount = rows.filter((r) => r.jenis === 'cuti_bersama').length;

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Hari Libur Nasional & Cuti Bersama</h1>
        <p className="text-sm text-[#6B6B6B] mt-1 max-w-[640px]">
          Tanggal di daftar ini tidak dihitung sebagai hari kerja: cuti tahunan tidak terpotong untuk tanggal merah,
          rekap absensi dan monitor kehadiran tidak menganggapnya &quot;Tidak Hadir&quot;, dan lembur di libur nasional
          otomatis berjenis Hari Libur Nasional. Karyawan yang jadwalnya ditandai &quot;bekerja di hari libur&quot; (Jadwal
          Kerja) tidak ikut dikecualikan.
        </p>
      </div>

      <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#6B6B6B] text-xs px-4 py-3 mb-6">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>
          Hanya berlaku ke depan: cuti yang sudah disetujui tidak dihitung ulang dan kuota yang sudah terpotong tidak
          berubah. Pengajuan yang masih menunggu memakai daftar terbaru saat disetujui. Mengisi tanggal yang sudah lewat
          memengaruhi tampilan rekap absensi bulan itu.
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTahun((t) => Math.max(TAHUN_LIBUR_MIN, t - 1))}
            disabled={tahun <= TAHUN_LIBUR_MIN}
            className="border border-[#E0E0E0] bg-white p-2 text-[#6B6B6B] hover:text-black disabled:opacity-40"
            aria-label="Tahun sebelumnya"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-sm font-medium text-black min-w-[48px] text-center">{tahun}</span>
          <button
            onClick={() => setTahun((t) => Math.min(TAHUN_LIBUR_MAX, t + 1))}
            disabled={tahun >= TAHUN_LIBUR_MAX}
            className="border border-[#E0E0E0] bg-white p-2 text-[#6B6B6B] hover:text-black disabled:opacity-40"
            aria-label="Tahun berikutnya"
          >
            <ChevronRight size={14} />
          </button>
          {!loading && !loadError && (
            <span className="text-xs text-[#9A9A9A] ml-2">
              {nasionalCount} libur nasional · {cutiBersamaCount} cuti bersama
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setImporError(null); setShowImpor(true); }}
            className="inline-flex items-center gap-1.5 border border-[#E0E0E0] bg-white text-black px-4 py-2 text-xs font-medium tracking-[0.04em] hover:border-madael-red transition-colors"
          >
            <Upload size={14} />
            Impor Satu Tahun
          </button>
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 bg-madael-red text-white px-4 py-2 text-xs font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            <Plus size={14} />
            Tambah Libur
          </button>
        </div>
      </div>

      {listMsg && (
        <div className={`text-xs px-3 py-2 mb-4 border ${
          listMsg.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          {listMsg.text}
        </div>
      )}

      {loading ? (
        <LoadingState label="Memuat hari libur..." />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : rows.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message={`Belum ada hari libur untuk ${tahun}. Klik Impor Satu Tahun atau Tambah Libur.`} />
        </div>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Nama</th>
                <th className="px-4 py-3 font-medium">Jenis</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-[#E0E0E0] last:border-0">
                  <td className="px-4 py-3 text-black whitespace-nowrap">{formatTanggalLibur(row.tanggal)}</td>
                  <td className="px-4 py-3 text-black">{row.nama}</td>
                  <td className="px-4 py-3"><JenisBadge jenis={row.jenis} /></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEdit(row)}
                      className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium mr-3"
                    >
                      <Pencil size={12} />
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(row)}
                      className="inline-flex items-center gap-1 text-xs text-[#9A9A9A] hover:text-red-600 font-medium"
                    >
                      <Trash2 size={12} />
                      Hapus
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6" onClick={handleFormBackdrop}>
          <div className="bg-white w-full max-w-[420px] p-6 relative max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <button onClick={closeForm} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black" aria-label="Tutup">
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-4">
              {editing ? `Edit Hari Libur — ${formatTanggalLibur(editing.tanggal)}` : 'Tambah Hari Libur'}
            </h2>

            {!editing && (
              <label className="flex flex-col gap-1 mb-4">
                <span className="text-xs text-[#6B6B6B]">Tanggal</span>
                <input
                  type="date"
                  value={form.tanggal}
                  onChange={(e) => setForm((f) => ({ ...f, tanggal: e.target.value }))}
                  className={inputClass}
                />
              </label>
            )}

            <label className="flex flex-col gap-1 mb-4">
              <span className="text-xs text-[#6B6B6B]">Nama</span>
              <input
                type="text"
                maxLength={MAKS_NAMA_LIBUR}
                placeholder="mis. Hari Kemerdekaan RI"
                value={form.nama}
                onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))}
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1 mb-6">
              <span className="text-xs text-[#6B6B6B]">Jenis</span>
              <select
                value={form.jenis}
                onChange={(e) => setForm((f) => ({ ...f, jenis: e.target.value }))}
                className={inputClass}
              >
                {JENIS_LIBUR_LIST.map((j) => (
                  <option key={j} value={j}>{JENIS_LIBUR[j].label}</option>
                ))}
              </select>
              <span className="text-[11px] text-[#9A9A9A]">
                Libur nasional dan cuti bersama sama-sama tidak dihitung sebagai hari cuti/hari kerja. Beda keduanya:
                hanya libur nasional yang otomatis menjadi jenis hari lembur &quot;Hari Libur Nasional&quot;.
              </span>
            </label>

            {formError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 mb-3">{formError}</div>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      )}

      {showImpor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6" onClick={handleImporBackdrop}>
          <div className="bg-white w-full max-w-[620px] p-6 relative max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <button onClick={closeImpor} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black" aria-label="Tutup">
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-1">Impor Hari Libur Satu Tahun</h2>
            <p className="text-xs text-[#6B6B6B] mb-4">
              Tempel daftar dari SKB 3 Menteri (satu baris per tanggal): <code>YYYY-MM-DD; Nama; jenis</code>. Jenis boleh
              dikosongkan (nasional) atau diisi <code>cuti bersama</code>. Maksimal {MAKS_BARIS_IMPOR_LIBUR} baris. Tanggal yang
              sudah ada dilewati, tidak ditimpa.
            </p>

            <textarea
              value={imporTeks}
              onChange={(e) => { setImporTeks(e.target.value); setImporError(null); }}
              rows={9}
              placeholder={CONTOH_IMPOR}
              className={`${inputClass} font-mono text-xs`}
            />

            {imporTeks.trim() !== '' && (
              <div className="mt-3 text-xs">
                <p className="text-[#6B6B6B] mb-2">
                  {imporPratinjau.items.length} baris siap diimpor
                  {imporPratinjau.errors.length > 0 && <span className="text-red-700"> · {imporPratinjau.errors.length} baris bermasalah</span>}
                </p>
                {imporPratinjau.errors.length > 0 && (
                  <ul className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 mb-2 space-y-1 max-h-[120px] overflow-y-auto">
                    {imporPratinjau.errors.map((e, i) => (
                      <li key={i}>{e.baris > 0 ? `Baris ${e.baris}: ` : ''}{e.pesan}</li>
                    ))}
                  </ul>
                )}
                {imporPratinjau.items.length > 0 && (
                  <div className="border border-[#E0E0E0] max-h-[160px] overflow-y-auto">
                    <table className="w-full">
                      <tbody>
                        {imporPratinjau.items.map((it) => (
                          <tr key={it.tanggal} className="border-b border-[#E0E0E0] last:border-0">
                            <td className="px-3 py-1.5 text-black whitespace-nowrap">{formatTanggalLibur(it.tanggal)}</td>
                            <td className="px-3 py-1.5 text-black">{it.nama}</td>
                            <td className="px-3 py-1.5"><JenisBadge jenis={it.jenis} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {imporError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 mt-3">{imporError}</div>
            )}
            <button
              onClick={handleImpor}
              disabled={imporSaving || imporPratinjau.items.length === 0 || imporPratinjau.errors.length > 0}
              className="w-full bg-madael-red text-white px-6 py-2.5 mt-4 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {imporSaving ? 'Mengimpor...' : `Impor ${imporPratinjau.items.length || ''} Hari Libur`.trim()}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus Hari Libur"
        message={
          deleteTarget && (
            <>
              Hapus <strong>{deleteTarget.nama}</strong> ({formatTanggalLibur(deleteTarget.tanggal)})? Tanggal ini akan
              dihitung sebagai hari kerja lagi untuk pengajuan yang masih menunggu. Cuti yang sudah disetujui tidak berubah.
            </>
          )
        }
        confirmLabel="Hapus"
        busyLabel="Menghapus..."
        busy={deleting}
        onConfirm={async () => {
          await executeDelete(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
