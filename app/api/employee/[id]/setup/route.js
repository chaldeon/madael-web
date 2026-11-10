import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { lengkapiSetupKaryawan } from '@/lib/employeeSetup';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';

// POST /api/employee/[id]/setup — "Perbaiki Setup Akun" di Employee List.
// Melengkapi apa yang belum ada untuk satu karyawan: akses modul default dan
// employees_master draft yang ter-link. Idempotent: hanya membuat yang belum
// ada (tidak menimpa akses/master yang sudah ada), jadi aman diklik berulang.
// Dipakai saat pembuatan akun (create / impor massal) melaporkan setup yang
// gagal, atau untuk karyawan lama yang barisnya hilang.
export async function POST(request, { params }) {
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

    // Sama seperti /api/employee/create: hanya superadmin.
    const { data: requester } = await supabase
      .from('employees')
      .select('id, is_superadmin')
      .eq('email', user.email)
      .maybeSingle();

    if (!requester?.is_superadmin) {
      return NextResponse.json(
        { error: 'Hanya superadmin yang boleh memperbaiki setup akun employee.' },
        { status: 403 }
      );
    }

    const admin = createAdminClient();

    const { data: emp, error: empError } = await admin
      .from('employees')
      .select('id, nama, client_id, is_superadmin')
      .eq('id', id)
      .maybeSingle();

    if (empError) {
      return NextResponse.json(
        { error: 'Gagal membaca data employee: ' + friendlyError(empError, 'terjadi kesalahan pada server.', { context: 'Baca employee (perbaiki setup)' }) },
        { status: 500 }
      );
    }
    if (!emp) {
      return NextResponse.json({ error: 'Employee tidak ditemukan.' }, { status: 404 });
    }

    const setup = await lengkapiSetupKaryawan(admin, emp);

    // Catat hanya kalau ada yang berubah atau gagal — klik pada akun yang sudah
    // lengkap tidak perlu menambah baris log.
    const adaPerubahan =
      setup.dibuat.akses_default > 0 || setup.dibuat.draft_master || setup.warnings.length > 0;
    if (adaPerubahan) {
      logActivity(admin, {
        userId: requester.id,
        aksi: 'perbaiki_setup_employee',
        targetTable: 'employees',
        targetId: emp.id,
        detail: {
          nama: emp.nama,
          dibuat: setup.dibuat,
          ...(setup.warnings.length > 0 ? { gagal: setup.warnings.map((w) => w.kode) } : {}),
        },
      });
    }

    return NextResponse.json(
      { success: setup.warnings.length === 0, dibuat: setup.dibuat, warnings: setup.warnings },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
