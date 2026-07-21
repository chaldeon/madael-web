import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';

// PATCH /api/employee/[id]
// Update data karyawan (nama, employee_id, perusahaan, status, is_superadmin).
// Email sengaja tidak diubah lewat sini karena email = identitas login di
// Supabase Auth — ubah email butuh flow terpisah (admin.auth.admin.updateUserById).
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

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
            // no-op — route ini tidak perlu set cookie baru
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum login.' }, { status: 401 });
    }

    // Verifikasi requester adalah superadmin
    const { data: requester } = await supabase
      .from('employees')
      .select('is_superadmin')
      .eq('email', user.email)
      .maybeSingle();

    if (!requester?.is_superadmin) {
      return NextResponse.json(
        { error: 'Hanya superadmin yang boleh mengubah data employee.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { nama, employee_id, perusahaan, status, is_superadmin } = body;

    if (!nama) {
      return NextResponse.json({ error: 'Nama wajib diisi.' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: empRow, error: empError } = await admin
      .from('employees')
      .update({
        nama,
        employee_id: employee_id || null,
        perusahaan: perusahaan || null,
        status: status || 'Aktif',
        is_superadmin: !!is_superadmin,
      })
      .eq('id', id)
      .select()
      .single();

    if (empError) {
      return NextResponse.json(
        { error: 'Gagal mengubah data employee: ' + empError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, employee: empRow }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}