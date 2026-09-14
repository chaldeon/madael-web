import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { MODULE_OPTIONS } from '@/lib/employeeModules';
import { logActivity } from '@/lib/activityLog';

const VALID_MODULE_KEYS = new Set(MODULE_OPTIONS.map((m) => m.key));

// Verifikasi requester adalah superadmin yang sedang login. Dipakai bareng
// oleh POST dan DELETE di bawah supaya konsisten dengan pola verifikasi di
// /api/employee/create dan /api/employee/[id].
async function getSuperadminRequester() {
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
    return { error: NextResponse.json({ error: 'Belum login.' }, { status: 401 }) };
  }

  const { data: requester } = await supabase
    .from('employees')
    .select('id, is_superadmin')
    .eq('email', user.email)
    .maybeSingle();

  if (!requester?.is_superadmin) {
    return {
      error: NextResponse.json(
        { error: 'Hanya superadmin yang boleh mengubah akses modul employee.' },
        { status: 403 }
      ),
    };
  }

  return { requester };
}

function validateModuleName(module_name) {
  if (!module_name || !VALID_MODULE_KEYS.has(module_name)) {
    return NextResponse.json({ error: 'module_name tidak valid.' }, { status: 400 });
  }
  return null;
}

// POST /api/employee/[id]/modules
// Grant akses satu modul ke employee. Body: { module_name }.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { requester, error: authError } = await getSuperadminRequester();
    if (authError) return authError;

    const { module_name } = await request.json();
    const validationError = validateModuleName(module_name);
    if (validationError) return validationError;

    const admin = createAdminClient();

    const { data: target, error: targetError } = await admin
      .from('employees')
      .select('id, nama')
      .eq('id', id)
      .maybeSingle();
    if (targetError || !target) {
      return NextResponse.json({ error: 'Employee tidak ditemukan.' }, { status: 404 });
    }

    const { error: insertError } = await admin
      .from('employee_modules')
      .insert([{ employee_id: id, module_name }]);

    if (insertError) {
      // Kemungkinan sudah punya akses ini (unique constraint) — anggap sukses
      // idempoten daripada dilempar sebagai error ke UI.
      if (insertError.code !== '23505') {
        return NextResponse.json(
          { error: 'Gagal menambah akses modul: ' + insertError.message },
          { status: 500 }
        );
      }
    }

    logActivity(admin, {
      userId: requester.id,
      aksi: 'tambah_akses_modul',
      targetTable: 'employee_modules',
      targetId: id,
      detail: { employee_nama: target.nama, module_name },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

// DELETE /api/employee/[id]/modules
// Cabut akses satu modul dari employee. Body: { module_name }.
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const { requester, error: authError } = await getSuperadminRequester();
    if (authError) return authError;

    const { module_name } = await request.json();
    const validationError = validateModuleName(module_name);
    if (validationError) return validationError;

    const admin = createAdminClient();

    const { data: target, error: targetError } = await admin
      .from('employees')
      .select('id, nama')
      .eq('id', id)
      .maybeSingle();
    if (targetError || !target) {
      return NextResponse.json({ error: 'Employee tidak ditemukan.' }, { status: 404 });
    }

    const { error: deleteError } = await admin
      .from('employee_modules')
      .delete()
      .eq('employee_id', id)
      .eq('module_name', module_name);

    if (deleteError) {
      return NextResponse.json(
        { error: 'Gagal menghapus akses modul: ' + deleteError.message },
        { status: 500 }
      );
    }

    logActivity(admin, {
      userId: requester.id,
      aksi: 'cabut_akses_modul',
      targetTable: 'employee_modules',
      targetId: id,
      detail: { employee_nama: target.nama, module_name },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}