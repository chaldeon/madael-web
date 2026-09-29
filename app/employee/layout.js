import FeedbackBubble from '@/components/FeedbackBubble';

// Layout induk semua halaman /employee/*. Layout turunan (absensi, payroll,
// dst.) tetap jalan seperti biasa; file ini cuma menambahkan bubble feedback
// yang mengambang di semua halaman untuk user yang sudah login.
export default function EmployeeRootLayout({ children }) {
  return (
    <>
      {children}
      <FeedbackBubble />
    </>
  );
}
