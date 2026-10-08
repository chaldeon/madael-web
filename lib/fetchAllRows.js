// Mengambil SEMUA baris hasil sebuah query Supabase lewat paginasi `.range()`.
//
// Kenapa perlu: PostgREST memotong respons di `max-rows` (bawaan Supabase 1.000)
// TANPA error. Query seperti "attendance sebulan untuk semua karyawan" (~45 orang
// x 22 hari kerja) atau "semua applications" bisa melewati batas itu, dan halaman
// akan menampilkan angka yang kurang tanpa tanda apa pun.
//
// Pemakaian — kirim FUNGSI PEMBANGUN query, bukan query-nya langsung:
//
//   const { data, error } = await fetchAllRows(() =>
//     supabase
//       .from('attendance')
//       .select('employee_id, tanggal, clock_in')
//       .gte('tanggal', firstDay)
//       .lte('tanggal', lastDay)
//   );
//
// Bentuk kembaliannya sama dengan Supabase (`{ data, error }`), jadi pemanggil
// cukup mengganti sumber datanya. Pada error, `data` bernilai null.
//
// Catatan desain:
// - Builder Supabase tidak aman dipakai ulang antar halaman (filter/range menumpuk
//   di instance yang sama), maka setiap halaman memanggil `buildQuery()` lagi.
// - Posisi maju mengikuti jumlah baris yang BENAR-BENAR diterima (`from += rows.length`),
//   bukan `pageSize`. Jadi tetap benar kalau `max-rows` server lebih kecil dari
//   `pageSize` (mis. 500): halaman yang kembali 500 baris tidak dianggap "terakhir".
//   Konsekuensinya, penanda akhir data adalah halaman KOSONG (satu request tambahan).
// - Urutan harus deterministik supaya tidak ada baris ganda/hilang antar halaman.
//   `.order(orderKey)` dipasang SETELAH urutan milik pemanggil, sehingga urutan
//   pemanggil tetap dipakai dan `id` hanya jadi pemutus seri. Kalau UI butuh urutan
//   lain, urutkan di client setelah data lengkap.
// - Jika data melebihi `maxPages`, fungsi mengembalikan ERROR, bukan data yang
//   terpotong: memotong diam-diam adalah persis bug yang dicegah helper ini.

export const DEFAULT_PAGE_SIZE = 1000;
export const DEFAULT_MAX_PAGES = 100;
export const FETCH_ALL_LIMIT_CODE = 'FETCH_ALL_LIMIT';

export async function fetchAllRows(
  buildQuery,
  { pageSize = DEFAULT_PAGE_SIZE, maxPages = DEFAULT_MAX_PAGES, orderKey = 'id' } = {}
) {
  const all = [];
  let from = 0;

  for (let page = 0; page < maxPages; page += 1) {
    let query = buildQuery();
    if (orderKey) query = query.order(orderKey, { ascending: true });
    const { data, error } = await query.range(from, from + pageSize - 1);

    if (error) return { data: null, error };

    const rows = data || [];
    if (rows.length === 0) return { data: all, error: null };

    for (const row of rows) all.push(row);
    from += rows.length;
  }

  return {
    data: null,
    error: {
      code: FETCH_ALL_LIMIT_CODE,
      message: `Jumlah data melebihi batas pengambilan (${maxPages} halaman).`,
    },
  };
}
