'use client';

import { ADMIN_PAGE_SIZE_OPTIONS, totalPagesOf } from '@/lib/pagination';

// Bilah paginasi untuk daftar admin berhalaman server-side. Tampilannya sama
// dengan bilah di Employee List. onPageSizeChange opsional (tanpa itu, pilihan
// "Per halaman" disembunyikan). catatanUrutan: tampilkan catatan bahwa urutan
// kolom hanya berlaku pada halaman yang sedang dibuka (untuk tabel yang bisa
// diurutkan di klien).
export default function PaginationBar({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  satuan = 'data',
  catatanUrutan = false,
  pageSizeOptions = ADMIN_PAGE_SIZE_OPTIONS,
}) {
  if (!totalCount || totalCount <= 0) return null;

  const totalPages = totalPagesOf(totalCount, pageSize);
  const awal = (page - 1) * pageSize + 1;
  const akhir = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-4 text-sm text-[#6B6B6B]">
      <div>
        Menampilkan {awal}–{akhir} dari {totalCount} {satuan}
      </div>
      <div className="flex items-center gap-4">
        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <label htmlFor="admin-page-size" className="whitespace-nowrap">Per halaman</label>
            <select
              id="admin-page-size"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="border border-[#E0E0E0] px-2 py-1 text-sm"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 border border-[#E0E0E0] disabled:opacity-40 hover:border-madael-red hover:text-madael-red transition-colors"
          >
            Sebelumnya
          </button>
          <span className="px-1 whitespace-nowrap">Halaman {page} / {totalPages}</span>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 border border-[#E0E0E0] disabled:opacity-40 hover:border-madael-red hover:text-madael-red transition-colors"
          >
            Berikutnya
          </button>
        </div>
      </div>
      {catatanUrutan && totalPages > 1 && (
        <p className="basis-full text-xs text-[#9A9A9A]">
          Urutan kolom hanya berlaku pada halaman yang sedang dibuka.
        </p>
      )}
    </div>
  );
}
