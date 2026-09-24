import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Ambil karyawan yang sedang login dari cookie sesi Supabase (server only).
// Pola yang sama dengan route absensi lain, dijadikan satu helper supaya
// route baru tidak menyalin boilerplate-nya lagi.
//
// columns : kolom employees yang dibutuhkan; WAJIB memuat 'status'.
// Return  : { user, emp } kalau lolos, atau { error, status } kalau tidak login
//           / akun tidak aktif (dipakai langsung sebagai respons JSON).
export async function getSessionEmployee(columns = 'id, status') {
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

  const { data: emp } = await supabase
    .from('employees')
    .select(columns)
    .eq('email', user.email)
    .maybeSingle();

  if (!emp || emp.status !== 'Aktif') return { error: 'Akun tidak aktif.', status: 403 };
  return { user, emp };
}