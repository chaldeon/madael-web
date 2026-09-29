'use client';

// Baris skeleton saat data awal masih dimuat — cuma dipakai untuk initial
// load (lihat `loading`), bukan untuk refresh-in-background setelah aksi
// (toggle status/tambah akses sudah update state lokal langsung, tanpa
// nge-refetch penuh, jadi tabel tidak perlu hilang lagi tiap ada aksi).
export default function SkeletonRows({ rows = 6 }) {
  return (
    <table className="w-full text-sm" aria-hidden="true">
      <tbody>
        {Array.from({ length: rows }).map((_, i) => (
          <tr key={i} className="border-b border-[#F0F0F0] last:border-0 animate-pulse">
            {Array.from({ length: 8 }).map((__, j) => (
              <td key={j} className="px-5 py-3.5">
                <div className="h-3 bg-[#EFEFEF] rounded-sm" style={{ width: j === 0 ? '70%' : '55%' }} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
