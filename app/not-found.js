import Link from 'next/link';

export const metadata = {
  title: "Halaman Tidak Ditemukan",
};

export default function NotFound() {
  return (
    <section className="min-h-[70vh] flex items-center justify-center bg-black border-b-4 border-madael-red px-6">
      <div className="text-center max-w-md">
        <p className="text-madael-red text-sm font-medium tracking-[0.2em] mb-3">ERROR 404</p>
        <h1 className="text-white text-3xl md:text-4xl font-semibold mb-4">
          Halaman Tidak Ditemukan
        </h1>
        <p className="text-gray-400 mb-8">
          Maaf, halaman yang Anda cari tidak tersedia atau sudah dipindahkan.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-block bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali ke Beranda
          </Link>
          <a
            href="https://wa.me/6285121548247?text=Halo%20Madael%20Consult%2C%20saya%20mencari%20halaman%20yang%20tidak%20ditemukan%20di%20website."
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block border border-white text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-white hover:text-black transition-colors"
          >
            Hubungi Kami
          </a>
        </div>
      </div>
    </section>
  );
}