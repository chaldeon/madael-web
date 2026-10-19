// Menyegarkan cache halaman publik /karir dan /karir/[slug] dari browser —
// fire and forget. Halaman itu di-cache (ISR), jadi setelah lowongan disimpan
// server perlu diminta membuang cache-nya lewat /api/job-listings/revalidate.
// Gagal menyegarkan tidak boleh membatalkan aksi utama: halaman tetap
// menyegarkan diri sendiri paling lambat sesuai `revalidate` di halamannya.
//
// slugs : slug lowongan yang berubah. Kirim slug lama DAN baru kalau slug diganti.
export function revalidateKarir(slugs = []) {
  const list = (Array.isArray(slugs) ? slugs : [slugs]).filter(Boolean);
  try {
    fetch('/api/job-listings/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slugs: list }),
      keepalive: true,
    }).catch((err) => console.error('Gagal menyegarkan halaman karir:', err));
  } catch (err) {
    console.error('Gagal menyegarkan halaman karir:', err);
  }
}
