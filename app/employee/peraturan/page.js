'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Scale, Search, Plus, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import { friendlyError } from '@/lib/errorMessage';
import {
  PERATURAN_MODULE_KEY, JENIS_OPTIONS, STATUS_OPTIONS, TOPIK_OPTIONS, PAGE_SIZE,
  MIN_TAHUN, MAX_TAHUN, labelPeraturan, formatTanggal,
} from '@/lib/peraturanConfig';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import { Chip, Cuplikan, StatusBadge, inputClass } from '@/components/peraturan/PeraturanParts';

const selectClass = inputClass;

export default function PeraturanListPage() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { employee } = useModuleAccess(PERATURAN_MODULE_KEY);
  // Tombol tambah hanya kosmetik; yang menegakkan hak tulis adalah RLS
  // (superadmin pemegang flag).
  const canEdit = !!employee?.is_superadmin;

  // --- State filter hidup di URL (bisa di-share, Back/Forward berfungsi) ---
  const q = searchParams.get('q') || '';
  const jenisParam = searchParams.get('jenis') || '';
  const statusParam = searchParams.get('status') || '';
  const topik = searchParams.get('topik') || '';
  const tahunParam = searchParams.get('tahun') || '';
  const kwKey = searchParams.getAll('kw').join('\u0001');
  const keywords = useMemo(() => (kwKey ? kwKey.split('\u0001') : []), [kwKey]);
  const page = Math.max(1, parseInt(searchParams.get('hal') || '1', 10) || 1);

  // Nilai dari URL divalidasi supaya URL buatan tangan tidak membuat query aneh.
  const jenis = JENIS_OPTIONS.includes(jenisParam) ? jenisParam : '';
  const status = STATUS_OPTIONS.includes(statusParam) ? statusParam : '';
  const tahunNum = Number(tahunParam);
  const tahun = Number.isInteger(tahunNum) && tahunNum >= MIN_TAHUN && tahunNum <= MAX_TAHUN ? String(tahunNum) : '';

  const updateParams = useCallback(
    (patch) => {
      const next = new URLSearchParams(searchParams.toString());
      Object.entries(patch).forEach(([key, value]) => {
        next.delete(key);
        if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
        else if (value !== '' && value != null) next.set(key, String(value));
      });
      // Ubah filter/pencarian selalu kembali ke halaman 1 (kecuali yang diubah memang halaman).
      if (!('hal' in patch)) next.delete('hal');
      const qs = next.toString();
      router.replace(qs ? `/employee/peraturan?${qs}` : '/employee/peraturan', { scroll: false });
    },
    [router, searchParams]
  );

  // --- Kotak pencarian: debounce input -> URL; URL -> input (Back/Forward) ---
  const [qInput, setQInput] = useState(q);
  const pushedQ = useRef(q);
  useEffect(() => {
    if (q !== pushedQ.current) {
      pushedQ.current = q;
      setQInput(q);
    }
  }, [q]);
  useEffect(() => {
    if (qInput === pushedQ.current) return undefined;
    const t = setTimeout(() => {
      pushedQ.current = qInput;
      updateParams({ q: qInput.trim() ? qInput : '' });
    }, 350);
    return () => clearTimeout(t);
  }, [qInput, updateParams]);

  // --- Opsi filter (tahun yang ada + keyword populer), sekali saat halaman dibuka ---
  const [opsi, setOpsi] = useState({ tahun: [], keywords: [] });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase.rpc('peraturan_opsi_filter', { p_limit_keyword: 40 });
      if (cancelled || err || !data) return; // non-fatal: filter tetap bisa dipakai tanpa daftar ini
      setOpsi({ tahun: data.tahun || [], keywords: data.keywords || [] });
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  // --- Data (paginasi di server lewat .range(); tidak ada filter di client) ---
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reqRef = useRef(0);

  const keywordsKey = keywords.join('\u0001');
  const load = useCallback(async () => {
    const req = ++reqRef.current;
    setLoading(true);
    setError('');

    const from = (page - 1) * PAGE_SIZE;
    const { data, error: err, count } = await supabase
      .rpc(
        'cari_peraturan',
        {
          p_q: q.trim() ? q : null,
          p_jenis: jenis || null,
          p_tahun: tahun ? Number(tahun) : null,
          p_status: status || null,
          p_topik: topik || null,
          p_keywords: keywordsKey ? keywordsKey.split('\u0001') : null,
        },
        { count: 'exact' }
      )
      .order('skor', { ascending: false })
      .order('tahun', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (req !== reqRef.current) return; // respons basi (filter sudah berubah lagi)

    // Halaman di luar jumlah data (mis. filter dipersempit) -> PostgREST 416; balik ke halaman 1.
    if (err?.code === 'PGRST103' && page > 1) {
      setLoading(false);
      updateParams({ hal: '' });
      return;
    }
    if (err) {
      setLoading(false);
      setError(friendlyError(err, 'Gagal memuat daftar peraturan.', { context: 'Cari peraturan' }));
      return;
    }
    setRows(data || []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [supabase, q, jenis, tahun, status, topik, keywordsKey, page, updateParams]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleKeyword = (kw) => {
    const next = keywords.includes(kw) ? keywords.filter((k) => k !== kw) : [...keywords, kw];
    updateParams({ kw: next });
  };

  const hasFilter = !!(q.trim() || jenis || tahun || status || topik || keywords.length);
  const resetAll = () => {
    setQInput('');
    pushedQ.current = '';
    router.replace('/employee/peraturan', { scroll: false });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(page * PAGE_SIZE, total);

  // Chip keyword: yang sedang aktif dulu, lalu yang populer.
  const popular = opsi.keywords.filter((k) => !keywords.includes(k.keyword));
  const tahunOptions = useMemo(() => {
    const set = new Set(opsi.tahun.map(String));
    if (tahun) set.add(tahun);
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [opsi.tahun, tahun]);

  return (
    <div className="max-w-[1200px] mx-auto px-6 md:px-10 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Scale size={18} className="text-madael-red" />
            <h1 className="text-2xl font-semibold text-black">Peraturan Ketenagakerjaan</h1>
          </div>
          <p className="text-sm text-[#6B6B6B]">
            Perpustakaan internal UU, PP, Permenaker, dan peraturan ketenagakerjaan lainnya. Selalu cek ulang ke sumber
            resmi sebelum dipakai sebagai dasar hukum.
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/employee/peraturan/impor"
              className="inline-flex items-center gap-2 border border-[#E0E0E0] bg-white text-black px-5 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-[#F4F4F4] transition-colors"
            >
              <Upload size={16} />
              Impor
            </Link>
            <Link
              href="/employee/peraturan/baru"
              className="inline-flex items-center gap-2 bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
            >
              <Plus size={16} />
              Tambah Peraturan
            </Link>
          </div>
        )}
      </div>

      {/* Pencarian + filter */}
      <div className="bg-white border border-[#E0E0E0] p-4 mb-4">
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9A9A9A]" />
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            maxLength={200}
            placeholder="Cari judul, nomor (mis. 35/2021), tentang, ringkasan, atau keyword..."
            className={`${inputClass} pl-9`}
            aria-label="Cari peraturan"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <select value={jenis} onChange={(e) => updateParams({ jenis: e.target.value })} className={selectClass} aria-label="Filter jenis">
            <option value="">Semua Jenis</option>
            {JENIS_OPTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
          <select value={tahun} onChange={(e) => updateParams({ tahun: e.target.value })} className={selectClass} aria-label="Filter tahun">
            <option value="">Semua Tahun</option>
            {tahunOptions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={status} onChange={(e) => updateParams({ status: e.target.value })} className={selectClass} aria-label="Filter status">
            <option value="">Semua Status</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={topik} onChange={(e) => updateParams({ topik: e.target.value })} className={selectClass} aria-label="Filter topik">
            <option value="">Semua Topik</option>
            {TOPIK_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {(keywords.length > 0 || popular.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#6B6B6B] mr-1">Keyword:</span>
            {keywords.map((kw) => (
              <Chip key={`aktif-${kw}`} label={kw} active onClick={() => toggleKeyword(kw)} />
            ))}
            {popular.map((k) => (
              <Chip key={k.keyword} label={k.keyword} count={k.jumlah} onClick={() => toggleKeyword(k.keyword)} />
            ))}
          </div>
        )}

        {hasFilter && (
          <button
            type="button"
            onClick={resetAll}
            className="mt-3 text-xs font-medium text-madael-red hover:text-madael-dark"
          >
            Reset pencarian & filter
          </button>
        )}
      </div>

      {/* Hasil */}
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : loading && rows.length === 0 ? (
        <LoadingState label="Memuat peraturan..." />
      ) : rows.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState
            icon={Scale}
            message={
              hasFilter
                ? 'Tidak ada peraturan yang cocok dengan pencarian atau filter ini.'
                : canEdit
                  ? 'Belum ada peraturan. Klik "Tambah Peraturan" untuk mulai mengisi.'
                  : 'Belum ada peraturan di perpustakaan.'
            }
          />
        </div>
      ) : (
        <div className={loading ? 'opacity-60' : ''}>
          <p className="text-xs text-[#6B6B6B] mb-3">
            Menampilkan {firstShown}–{lastShown} dari {total} peraturan
          </p>

          <div className="space-y-3">
            {rows.map((row) => (
              <article key={row.id} className="bg-white border border-[#E0E0E0] p-4 hover:border-madael-red transition-colors">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-[11px] font-medium text-madael-red tracking-[0.04em] uppercase">
                    {labelPeraturan(row)}
                  </span>
                  <StatusBadge status={row.status} />
                </div>

                <Link
                  href={`/employee/peraturan/${row.id}`}
                  className="block text-base font-medium text-black hover:text-madael-red"
                >
                  {row.judul}
                </Link>

                {row.tentang && <p className="text-sm text-[#3D3D3D] mt-1 line-clamp-2">{row.tentang}</p>}
                <Cuplikan text={row.cuplikan} />

                <p className="text-[11px] text-[#9A9A9A] mt-2">
                  Berlaku sejak {formatTanggal(row.tanggal_berlaku)}
                </p>

                {(row.topik?.length > 0 || row.keywords?.length > 0) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.topik?.map((t) => (
                      <Chip key={`t-${t}`} label={t} active={t === topik} onClick={() => updateParams({ topik: t === topik ? '' : t })} />
                    ))}
                    {row.keywords?.map((kw) => (
                      <Chip key={`k-${kw}`} label={`#${kw}`} active={keywords.includes(kw)} onClick={() => toggleKeyword(kw)} />
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 text-sm text-[#6B6B6B]">
              <button
                type="button"
                onClick={() => updateParams({ hal: page - 1 > 1 ? page - 1 : '' })}
                disabled={page <= 1 || loading}
                className="px-4 py-2 border border-[#E0E0E0] bg-white hover:bg-[#F4F4F4] disabled:opacity-40"
              >
                ← Sebelumnya
              </button>
              <span>Halaman {page} dari {totalPages}</span>
              <button
                type="button"
                onClick={() => updateParams({ hal: page + 1 })}
                disabled={page >= totalPages || loading}
                className="px-4 py-2 border border-[#E0E0E0] bg-white hover:bg-[#F4F4F4] disabled:opacity-40"
              >
                Berikutnya →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
