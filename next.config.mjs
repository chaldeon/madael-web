/** @type {import('next').NextConfig} */
const nextConfig = {
  // Halaman admin Job Portal lama (/admin, /admin/lowongan, /login) sudah
  // dihapus karena tidak mengikuti model akses modul. Redirect sementara
  // (permanent: false) supaya bookmark lama tetap jalan ke halaman penggantinya.
  // redirects() di config dijalankan SEBELUM middleware, jadi pengunjung yang
  // belum login tetap diarahkan ke /employee/login oleh middleware di tujuan.
  // Urutan penting: aturan spesifik harus di atas /admin/:path*.
  async redirects() {
    return [
      { source: '/admin', destination: '/employee/job-portal/pelamar', permanent: false },
      { source: '/admin/lowongan', destination: '/employee/job-portal', permanent: false },
      { source: '/admin/:path*', destination: '/employee/job-portal', permanent: false },
      { source: '/login', destination: '/employee/login', permanent: false },
    ];
  },
};

export default nextConfig;
