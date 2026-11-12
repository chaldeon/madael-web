import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { FREELANCER_STATUS } from '@/lib/freelancerModules';

// SERVER ONLY — ambil Freelancer yang sedang login dari cookie sesi Supabase.
// Padanan getSessionEmployee (lib/sessionEmployee.js) untuk akun Freelancer.
//
// Perbedaan penting:
// - Dicocokkan lewat auth_user_id (user.id dari sesi yang sudah diverifikasi
//   server Supabase), BUKAN lewat email. Email bisa berubah; id auth tidak.
// - Baris dibaca dengan client service role, karena kolom sensitif (rekening,
//   NPWP/NIK) sengaja tidak punya izin SELECT untuk role authenticated. Aman
//   selama `columns` dibatasi pemanggil dan hasilnya hanya untuk pemilik akun.
// - Akun karyawan TIDAK pernah lolos di sini (tidak ada baris freelancers),
//   dan Freelancer TIDAK lolos di getSessionEmployee (tidak ada baris employees).
//
// columns : kolom freelancers yang dibutuhkan; WAJIB memuat 'status'.
// Return  : { user, freelancer } kalau lolos, atau { error, status } yang dipakai
//           langsung sebagai respons JSON (401 belum login, 403 bukan Freelancer
//           atau akun tidak active).
export async function getSessionFreelancer(columns = 'id, status') {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // no-op — helper ini cuma butuh baca session
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Belum login.', status: 401 };

  const admin = createAdminClient();
  const { data: freelancer, error } = await admin
    .from('freelancers')
    .select(columns)
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (error) throw error;

  if (!freelancer) return { error: 'Akun ini bukan akun Freelancer.', status: 403 };
  if (freelancer.status !== FREELANCER_STATUS.ACTIVE) {
    return { error: 'Akun Freelancer tidak aktif.', status: 403 };
  }
  return { user, freelancer };
}
