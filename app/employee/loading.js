import LoadingState from '@/components/LoadingState';

// Tampil instan saat pindah antar halaman employee (sebelum chunk halaman
// tujuan selesai dimuat). Gayanya sama dengan loading di layout modul.
export default function EmployeeLoading() {
  return (
    <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
      <LoadingState label="Memuat..." />
    </section>
  );
}