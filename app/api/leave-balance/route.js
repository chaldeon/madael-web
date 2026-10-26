import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { hitungSisaCuti, tahunSekarang } from '@/lib/leave';
import { ambilKebijakanCuti, KOLOM_MASTER_CUTI } from '@/lib/leaveServer';
import { friendlyError } from '@/lib/errorMessage';

// GET /api/leave-balance
// Sisa jatah cuti tahun berjalan untuk employee yang sedang login. Pakai
// service role untuk baca employees_master (RLS-nya dibatasi superadmin
// karena berisi kolom gaji) supaya employee biasa bisa lihat sisa cutinya
// sendiri tanpa perlu dikasih akses baca ke data gaji.
export async function GET() {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll() {},
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum login.' }, { status: 401 });
    }

    const { data: emp } = await supabase
      .from('employees')
      .select('id')
      .eq('email', user.email)
      .maybeSingle();

    if (!emp) {
      return NextResponse.json({ error: 'Data karyawan tidak ditemukan.' }, { status: 404 });
    }

    const admin = createAdminClient();
    const [masterRes, policyRes] = await Promise.all([
      admin.from('employees_master').select(KOLOM_MASTER_CUTI).eq('linked_employee_id', emp.id).maybeSingle(),
      ambilKebijakanCuti(admin),
    ]);
    const master = masterRes.data;
    const error = masterRes.error || policyRes.error;

    if (error) {
      return NextResponse.json({ error: friendlyError(error, 'Gagal memuat sisa cuti.', { context: 'Muat sisa cuti' }) }, { status: 500 });
    }

    if (!master) {
      // Belum terhubung ke employees_master — belum ada data kuota.
      return NextResponse.json({ linked: false }, { status: 200 });
    }

    const balance = hitungSisaCuti(master, tahunSekarang(), policyRes.kebijakan);
    return NextResponse.json({ linked: true, ...balance }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}