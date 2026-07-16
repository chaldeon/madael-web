import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';

export async function POST(request) {
  try {
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
        { error: 'Hanya superadmin yang boleh menambah employee.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { nama, employee_id, email, perusahaan, status, is_superadmin } = body;

    if (!nama || !email) {
      return NextResponse.json({ error: 'Nama dan email wajib diisi.' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Password sementara — belum ada flow reset password di sprint ini,
    // jadi password ini perlu disampaikan manual ke employee baru.
    const tempPassword = Math.random().toString(36).slice(-10) + 'Aa1!';

    const { data: authUser, error: authError } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });

    if (authError) {
      return NextResponse.json(
        { error: 'Gagal membuat akun Auth: ' + authError.message },
        { status: 500 }
      );
    }

    const { data: empRow, error: empError } = await admin
      .from('employees')
      .insert([
        {
          nama,
          employee_id: employee_id || null,
          email,
          perusahaan: perusahaan || null,
          status: status || 'Aktif',
          is_superadmin: !!is_superadmin,
        },
      ])
      .select()
      .single();

    if (empError) {
      // rollback akun auth kalau insert ke tabel employees gagal
      await admin.auth.admin.deleteUser(authUser.user.id);
      return NextResponse.json(
        { error: 'Gagal menyimpan data employee: ' + empError.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, employee: empRow, tempPassword },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}