'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Trash2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { logActivity } from '@/lib/activityLogClient';
import { friendlyError } from '@/lib/errorMessage';
import { RELASI_LABEL, RELASI_OPTIONS, LIMITS, labelPeraturan } from '@/lib/peraturanConfig';
import ConfirmDialog from '@/components/ConfirmDialog';
import { StatusBadge, inputClass, labelClass } from '@/components/peraturan/PeraturanParts';

const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_MIN_CHARS = 2;
const SEARCH_LIMIT = 8;

// Panel kelola relasi (hanya dirender untuk superadmin pemegang flag; RLS tetap
// penegak akhirnya). Menggantikan daftar relasi read-only di halaman detail.
//
// Props:
// - peraturan : baris peraturan yang sedang dibuka ({ id, jenis, nomor, tahun })
// - groups    : relasi yang sudah dikelompokkan halaman detail
//               [{ key, label, arah: 'keluar' | 'masuk', jenisRelasi, items: [{ id, ref, catatan }] }]
// - employeeId: id employee yang login (untuk activity log)
// - onChanged : dipanggil setelah tambah/hapus berhasil (halaman memuat ulang relasi)
export default function RelasiManager({ peraturan, groups, employeeId, onChanged }) {
  const supabase = createClient();

  const [jenis, setJenis] = useState(RELASI_OPTIONS[0].value);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [target, setTarget] = useState(null);
  const [catatan, setCatatan] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

  const [deleteTarget, setDeleteTarget] = useState(null); // { group, item }
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const reqRef = useRef(0);

  // Relasi keluar yang sudah ada: "<jenis>:<id target>" -> dipakai menandai hasil
  // pencarian yang akan ditolak sebagai duplikat.
  const existingKeys = new Set(
    groups
      .filter((g) => g.arah === 'keluar')
      .flatMap((g) => g.items.map((item) => `${g.jenisRelasi}:${item.ref.id}`))
  );

  // Pencarian target: debounce, hasil basi dibuang, peraturan ini dikecualikan.
  useEffect(() => {
    const q = query.trim().slice(0, 80);
    if (target || q.length < SEARCH_MIN_CHARS) return undefined; // state dibersihkan di handler

    const timer = setTimeout(async () => {
      const req = ++reqRef.current;
      setSearching(true);
      setSearchError('');
      // Parameter lain dikirim null seperti di halaman daftar (signature RPC sama).
      const { data, error: err } = await supabase
        .rpc('cari_peraturan', {
          p_q: q,
          p_jenis: null,
          p_tahun: null,
          p_status: null,
          p_topik: null,
          p_keywords: null,
        })
        .order('skor', { ascending: false })
        .order('tahun', { ascending: false })
        .order('id', { ascending: true })
        .range(0, SEARCH_LIMIT); // +1 baris cadangan: peraturan ini bisa ikut terambil

      if (req !== reqRef.current) return;
      setSearching(false);
      if (err) {
        setResults([]);
        setSearchError(friendlyError(err, 'Gagal mencari peraturan.', { context: 'Cari target relasi' }));
        return;
      }
      setResults((data || []).filter((r) => r.id !== peraturan.id).slice(0, SEARCH_LIMIT));
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [supabase, query, target, peraturan.id]);

  // Membatalkan respons yang masih jalan dan mengosongkan hasil pencarian.
  const resetSearch = () => {
    reqRef.current += 1;
    setResults([]);
    setSearching(false);
    setSearchError('');
  };

  const handleQueryChange = (value) => {
    setQuery(value);
    if (value.trim().length < SEARCH_MIN_CHARS) resetSearch();
  };

  const pickTarget = (row) => {
    resetSearch();
    setTarget(row);
    setQuery('');
    setFormError('');
    setNotice('');
  };

  const isDuplicate = target ? existingKeys.has(`${jenis}:${target.id}`) : false;

  const handleAdd = async () => {
    setFormError('');
    setNotice('');
    if (!target) {
      setFormError('Pilih peraturan target terlebih dahulu.');
      return;
    }
    if (target.id === peraturan.id) {
      setFormError('Peraturan tidak bisa berelasi dengan dirinya sendiri.');
      return;
    }
    if (isDuplicate) {
      setFormError('Relasi ini sudah ada.');
      return;
    }
    const catatanBersih = catatan.trim();
    if (catatanBersih.length > LIMITS.catatanRelasi) {
      setFormError(`Catatan maksimal ${LIMITS.catatanRelasi} karakter.`);
      return;
    }

    setSaving(true);
    const { data, error: err } = await supabase
      .from('peraturan_relasi')
      .insert([{
        peraturan_id: peraturan.id,
        terkait_id: target.id,
        jenis_relasi: jenis,
        catatan: catatanBersih || null,
      }])
      .select('id')
      .single();
    setSaving(false);

    if (err) {
      if (err.code === '23505') {
        setFormError('Relasi ini sudah ada.');
      } else if (err.code === '23514' && /bukan_diri/.test(err.message || '')) {
        setFormError('Peraturan tidak bisa berelasi dengan dirinya sendiri.');
      } else {
        setFormError(friendlyError(err, 'Gagal menyimpan relasi.', { context: 'Tambah relasi peraturan' }));
      }
      return;
    }

    logActivity({
      aksi: 'tambah_relasi_peraturan',
      targetTable: 'peraturan_relasi',
      targetId: data.id,
      detail: {
        dari: labelPeraturan(peraturan),
        jenis_relasi: jenis,
        ke: labelPeraturan(target),
        ...(catatanBersih ? { catatan: catatanBersih } : {}),
      },
    });

    setNotice(`Relasi ke ${labelPeraturan(target)} ditambahkan.`);
    setTarget(null);
    setCatatan('');
    onChanged?.();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { group, item } = deleteTarget;
    setDeleting(true);
    setDeleteError('');
    setNotice('');

    // .select() supaya terlihat kalau RLS menolak (delete diam-diam 0 baris).
    const { data, error: err } = await supabase
      .from('peraturan_relasi')
      .delete()
      .eq('id', item.id)
      .select('id');
    setDeleting(false);
    setDeleteTarget(null);

    if (err) {
      setDeleteError(friendlyError(err, 'Gagal menghapus relasi.', { context: 'Hapus relasi peraturan' }));
      return;
    }
    if (!data || data.length === 0) {
      setDeleteError('Relasi tidak terhapus: kamu tidak punya izin, atau relasinya sudah tidak ada.');
      onChanged?.();
      return;
    }

    const labelIni = labelPeraturan(peraturan);
    const labelLain = labelPeraturan(item.ref);
    logActivity({
      aksi: 'hapus_relasi_peraturan',
      targetTable: 'peraturan_relasi',
      targetId: item.id,
      detail: {
        dari: group.arah === 'keluar' ? labelIni : labelLain,
        jenis_relasi: group.jenisRelasi,
        ke: group.arah === 'keluar' ? labelLain : labelIni,
        ...(item.catatan ? { catatan: item.catatan } : {}),
      },
    });
    onChanged?.();
  };

  const busy = saving || deleting;

  return (
    <div className="mt-6 pt-6 border-t border-[#E0E0E0]">
      <h2 className="text-sm font-medium text-black mb-3">Relasi Peraturan</h2>

      {groups.length === 0 ? (
        <p className="text-sm text-[#6B6B6B]">Belum ada relasi.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.key}>
              <p className="text-xs text-[#6B6B6B] mb-1">{group.label}</p>
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li key={item.id} className="text-sm flex items-start gap-2">
                    <span className="flex-1 min-w-0 break-words">
                      <Link href={`/employee/peraturan/${item.ref.id}`} className="text-madael-red hover:text-madael-dark">
                        {labelPeraturan(item.ref)}
                      </Link>
                      <span className="text-[#3D3D3D]"> — {item.ref.judul}</span>
                      {item.catatan && <span className="text-[#9A9A9A]"> ({item.catatan})</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setDeleteError(''); setDeleteTarget({ group, item }); }}
                      disabled={busy}
                      aria-label={`Hapus relasi ${group.label} ${labelPeraturan(item.ref)}`}
                      className="shrink-0 p-1 text-[#9A9A9A] hover:text-red-700 disabled:opacity-40 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {deleteError && <p className="text-xs text-red-600 mt-3">{deleteError}</p>}

      <div className="mt-5 border border-[#E0E0E0] bg-[#FAFAFA] p-4">
        <p className="text-xs font-medium text-black mb-3">Tambah relasi</p>

        <div className="space-y-3">
          <div>
            <label htmlFor="relasi-jenis" className={labelClass}>
              Peraturan ini ...
            </label>
            <select
              id="relasi-jenis"
              value={jenis}
              onChange={(e) => { setJenis(e.target.value); setFormError(''); }}
              disabled={saving}
              className={inputClass}
            >
              {RELASI_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="relasi-cari" className={labelClass}>
              Peraturan target
            </label>
            {target ? (
              <div className="flex items-start gap-2 border border-[#E0E0E0] bg-white px-3 py-2">
                <span className="flex-1 min-w-0 text-sm break-words">
                  <span className="text-madael-red">{labelPeraturan(target)}</span>
                  <span className="text-[#3D3D3D]"> — {target.judul}</span>
                </span>
                <button
                  type="button"
                  onClick={() => { setTarget(null); setFormError(''); }}
                  disabled={saving}
                  aria-label="Ganti peraturan target"
                  className="shrink-0 p-0.5 text-[#6B6B6B] hover:text-black disabled:opacity-40"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9A9A9A]" />
                  <input
                    id="relasi-cari"
                    type="text"
                    value={query}
                    onChange={(e) => handleQueryChange(e.target.value)}
                    maxLength={80}
                    placeholder="Cari nomor atau judul, mis. PP 35 atau cipta kerja"
                    autoComplete="off"
                    className={`${inputClass} pl-9`}
                  />
                </div>
                {searching && <p className="text-xs text-[#6B6B6B] mt-2">Mencari...</p>}
                {searchError && <p className="text-xs text-red-600 mt-2">{searchError}</p>}
                {!searching && !searchError && query.trim().length >= SEARCH_MIN_CHARS && results.length === 0 && (
                  <p className="text-xs text-[#6B6B6B] mt-2">Tidak ada peraturan yang cocok.</p>
                )}
                {results.length > 0 && (
                  <ul className="mt-2 border border-[#E0E0E0] bg-white divide-y divide-[#E0E0E0]">
                    {results.map((r) => {
                      const sudahAda = existingKeys.has(`${jenis}:${r.id}`);
                      return (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => pickTarget(r)}
                            disabled={sudahAda}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-[#F4F4F4] disabled:opacity-50 disabled:hover:bg-white disabled:cursor-not-allowed"
                          >
                            <span className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-medium text-madael-red">{labelPeraturan(r)}</span>
                              <StatusBadge status={r.status} />
                              {sudahAda && (
                                <span className="text-[11px] text-[#6B6B6B]">
                                  sudah {RELASI_LABEL[jenis].keluar.toLowerCase()}
                                </span>
                              )}
                            </span>
                            <span className="block text-[#3D3D3D] break-words">{r.judul}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </div>

          <div>
            <label htmlFor="relasi-catatan" className={labelClass}>
              Catatan (opsional)
            </label>
            <input
              id="relasi-catatan"
              type="text"
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              maxLength={LIMITS.catatanRelasi}
              placeholder="mis. hanya Pasal 81 yang diubah"
              disabled={saving}
              className={inputClass}
            />
          </div>
        </div>

        {formError && <p className="text-xs text-red-600 mt-3">{formError}</p>}
        {notice && !formError && <p className="text-xs text-green-700 mt-3">{notice}</p>}

        <button
          type="button"
          onClick={handleAdd}
          disabled={busy || !target || isDuplicate}
          className="mt-4 inline-flex items-center gap-2 bg-madael-red text-white px-5 py-2 text-xs font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Plus size={14} />
          {saving ? 'Menyimpan...' : 'Tambah Relasi'}
        </button>
        {isDuplicate && <p className="text-xs text-[#6B6B6B] mt-2">Relasi ini sudah ada.</p>}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus Relasi"
        message={
          deleteTarget && (
            <>
              Hapus relasi <strong>{deleteTarget.group.label}</strong>{' '}
              <strong>{labelPeraturan(deleteTarget.item.ref)}</strong>? Peraturan itu sendiri tidak ikut terhapus.
            </>
          )
        }
        confirmLabel="Hapus"
        busyLabel="Menghapus..."
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
