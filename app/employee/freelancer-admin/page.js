'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, X, Paperclip } from 'lucide-react';
import { callJsonApi } from '@/lib/apiClient';
import {
  FREELANCER_ADMIN_BASE,
  FREELANCER_FILTER_STATUS_OPTIONS,
  FREELANCER_SORT_COLUMNS,
} from '@/lib/freelancerAdminConfig';
import { ADMIN_PAGE_SIZE_DEFAULT } from '@/lib/pagination';
import SortableHeader from '@/components/SortableHeader';
import PaginationBar from '@/components/PaginationBar';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import SkeletonRows from '@/components/employee-list/SkeletonRows';
import FreelancerStatusBadge from '@/components/freelancer-admin/FreelancerStatusBadge';

const selectClass =
  'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

function formatTanggal(value) {
  if (!value) return '—';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function FreelancerAdminListPage() {
  const [searchQuery, setSearchQuery] = useState('');
  // Pencarian di-debounce supaya tiap ketikan tidak langsung menembak server.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortField, setSortField] = useState('freelancer_code');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(ADMIN_PAGE_SIZE_DEFAULT);
  const [reloadTick, setReloadTick] = useState(0);

  // Hasil terakhir + kunci query yang menghasilkannya. `loading` diturunkan dari
  // perbedaan kunci, jadi tidak ada setState sinkron di dalam effect.
  const [result, setResult] = useState({ key: null, rows: [], totalCount: 0, error: null });

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const queryString = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set('page', String(page));
    sp.set('pageSize', String(pageSize));
    sp.set('sort', sortField);
    sp.set('dir', sortDir);
    if (filterStatus) sp.set('status', filterStatus);
    if (debouncedSearch) sp.set('q', debouncedSearch);
    return sp.toString();
  }, [page, pageSize, sortField, sortDir, filterStatus, debouncedSearch]);

  const requestKey = `${queryString}|${reloadTick}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await callJsonApi(`/api/freelancers?${queryString}`, 'GET');
      if (cancelled) return;
      if (!res.ok) {
        setResult({ key: requestKey, rows: [], totalCount: 0, error: res.error });
        return;
      }
      // Halaman melewati akhir data (daftar menyusut): kembali ke halaman 1.
      if (res.data.outOfRange && page > 1) {
        setPage(1);
        return;
      }
      setResult({
        key: requestKey,
        rows: res.data.freelancers || [],
        totalCount: res.data.totalCount || 0,
        error: null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [queryString, requestKey, page]);

  const loading = result.key !== requestKey;
  const { rows, totalCount, error } = result;

  const handleSort = (colKey) => {
    if (sortField === colKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(colKey);
      setSortDir('asc');
    }
    setPage(1);
  };

  const handleFilterStatus = (value) => {
    setFilterStatus(value);
    setPage(1);
  };

  const handlePageSize = (size) => {
    setPageSize(size);
    setPage(1);
  };

  const sortProps = { sortField, sortDir, onSort: handleSort };

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-10">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">
            Kelola Freelancer
          </h1>
          <p className="text-sm text-[#6B6B6B] mt-1">
            {loading && result.key === null ? 'Memuat...' : `${totalCount} Freelancer`}
          </p>
        </div>
        <Link
          href={`${FREELANCER_ADMIN_BASE}/baru`}
          className="bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors whitespace-nowrap"
        >
          + Tambah Freelancer
        </Link>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[240px] max-w-[360px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9A9A9A] pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama, Freelancer ID, email, atau WhatsApp..."
            aria-label="Cari Freelancer"
            className="w-full border border-[#E0E0E0] pl-8 pr-8 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Hapus pencarian"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9A9A9A] hover:text-black"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <select
          value={filterStatus}
          onChange={(e) => handleFilterStatus(e.target.value)}
          className={selectClass}
          aria-label="Filter status akun"
        >
          {FREELANCER_FILTER_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
        {loading ? (
          <>
            <span className="sr-only" role="status">Memuat data Freelancer...</span>
            <SkeletonRows />
          </>
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReloadTick((t) => t + 1)} />
        ) : rows.length === 0 ? (
          <EmptyState
            message={
              debouncedSearch || filterStatus
                ? 'Tidak ada Freelancer yang cocok dengan pencarian atau filter.'
                : 'Belum ada Freelancer. Klik "+ Tambah Freelancer" untuk mendaftarkan yang pertama.'
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B] tracking-[0.04em]">
                <SortableHeader colKey="freelancer_code" label={FREELANCER_SORT_COLUMNS.freelancer_code} {...sortProps} />
                <SortableHeader colKey="nama_lengkap" label={FREELANCER_SORT_COLUMNS.nama_lengkap} {...sortProps} />
                <SortableHeader colKey="email" label={FREELANCER_SORT_COLUMNS.email} {...sortProps} />
                <th className="px-5 py-3 font-medium whitespace-nowrap">WhatsApp</th>
                <SortableHeader colKey="status" label={FREELANCER_SORT_COLUMNS.status} {...sortProps} />
                <th className="px-5 py-3 font-medium whitespace-nowrap">Agreement</th>
                <SortableHeader colKey="tanggal_bergabung" label={FREELANCER_SORT_COLUMNS.tanggal_bergabung} {...sortProps} />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-b border-[#F0F0F0] last:border-0">
                  <td className="px-5 py-3.5 text-[#6B6B6B] whitespace-nowrap">{f.freelancer_code}</td>
                  <td className="px-5 py-3.5 text-black">
                    <Link
                      href={`${FREELANCER_ADMIN_BASE}/${f.id}`}
                      className="hover:text-madael-red hover:underline underline-offset-2"
                    >
                      {f.nama_lengkap}
                    </Link>
                    {f.has_cv && (
                      <Paperclip size={12} className="inline ml-2 text-[#9A9A9A]" aria-label="CV sudah diunggah" />
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-[#6B6B6B]">{f.email}</td>
                  <td className="px-5 py-3.5 text-[#6B6B6B] whitespace-nowrap">{f.no_whatsapp || '—'}</td>
                  <td className="px-5 py-3.5"><FreelancerStatusBadge status={f.status} /></td>
                  <td className="px-5 py-3.5 text-[#9A9A9A]" title="Status Agreement tersedia setelah fitur Agreement dibuat">
                    {f.agreement_status || '—'}
                  </td>
                  <td className="px-5 py-3.5 text-[#6B6B6B] whitespace-nowrap">{formatTanggal(f.tanggal_bergabung)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && !error && (
        <PaginationBar
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={setPage}
          onPageSizeChange={handlePageSize}
          satuan="Freelancer"
        />
      )}
    </div>
  );
}
