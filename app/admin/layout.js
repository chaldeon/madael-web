import AdminNav from '@/components/AdminNav';

export default function AdminLayout({ children }) {
  return (
    <div className="min-h-screen bg-white">
      <AdminNav />
      <main>{children}</main>
    </div>
  );
}