import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';

// PATCH /api/employee/[id]
// Update data karyawan (nama, employee_id, client_id, status, is_superadmin).
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
    const { nama, employee_id, client_id, status, is_superadmin } = body;

    if (!nama) {
      return NextResponse.json({ error: 'Nama wajib diisi.' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: empRow, error: empError } = await admin
      .from('employees')
      .update({
        nama,
        employee_id: employee_id || null,
        client_id: client_id || null,
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

// Cari user Supabase Auth berdasarkan email. Tidak ada kolom auth_user_id
// tersimpan di tabel `employees` (lihat catatan di /api/employee/create),
// jadi resolve dengan cara paginate admin.auth.admin.listUsers(). Cukup
// murah untuk ukuran perusahaan sekarang; kalau jumlah user sudah besar,
// pertimbangkan tambah kolom auth_user_id supaya lookup ini O(1).
async function findAuthUserIdByEmail(admin, email) {
  const target = email.toLowerCase();
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 25; i += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) return null;
    const found = data.users.find((u) => (u.email || '').toLowerCase() === target);
    if (found) return found.id;
    if (data.users.length < perPage) return null; // halaman terakhir
    page += 1;
  }
  return null;
}

// DELETE /api/employee/[id]
// Hapus PERMANEN akun employee — hanya untuk kasus salah input / akun yang
// belum pernah punya histori apa pun. Kalau employee sudah punya jejak data
// (absensi, cuti, payslip, dokumen), request ini DITOLAK (409) dan superadmin
// diarahkan untuk pakai Nonaktifkan (PATCH status='Nonaktif') supaya data
// historis yang mungkin masih dibutuhkan untuk keperluan pajak/BPJS/audit
// tidak ikut hilang.
export async function DELETE(request, { params }) {
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

    const { data: requester } = await supabase
      .from('employees')
      .select('id, is_superadmin')
      .eq('email', user.email)
      .maybeSingle();

    if (!requester?.is_superadmin) {
      return NextResponse.json(
        { error: 'Hanya superadmin yang boleh menghapus employee.' },
        { status: 403 }
      );
    }

    if (requester.id === id) {
      return NextResponse.json(
        { error: 'Tidak bisa menghapus akun sendiri yang sedang login.' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    const { data: target, error: targetError } = await admin
      .from('employees')
      .select('id, nama, email, is_superadmin')
      .eq('id', id)
      .maybeSingle();

    if (targetError || !target) {
      return NextResponse.json({ error: 'Employee tidak ditemukan.' }, { status: 404 });
    }

    // Jangan sampai perusahaan kehilangan superadmin terakhir.
    if (target.is_superadmin) {
      const { count: superadminCount } = await admin
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('is_superadmin', true);
      if ((superadminCount || 0) <= 1) {
        return NextResponse.json(
          { error: 'Tidak bisa menghapus satu-satunya akun superadmin yang tersisa.' },
          { status: 400 }
        );
      }
    }

    // Cari row employees_master yang ter-link (kalau ada) untuk cek histori
    // payroll di bawahnya sebelum ikut menghapusnya.
    const { data: masterRows } = await admin
      .from('employees_master')
      .select('id')
      .eq('linked_employee_id', id);
    const masterIds = (masterRows || []).map((m) => m.id);

    const dependencyChecks = [
      { label: 'riwayat absensi', table: 'attendance', column: 'employee_id' },
      { label: 'riwayat koreksi absensi', table: 'attendance_corrections', column: 'employee_id' },
      { label: 'riwayat pengajuan cuti', table: 'leave_requests', column: 'employee_id' },
      { label: 'slip gaji (payslip)', table: 'payslips', column: 'employee_id' },
      { label: 'dokumen yang pernah dibuat', table: 'documents', column: 'created_by' },
      { label: 'dokumen pribadi (kontrak, dll)', table: 'employee_documents', column: 'employee_id' },
    ];

    const blockingReasons = [];
    for (const check of dependencyChecks) {
      const { count } = await admin
        .from(check.table)
        .select('id', { count: 'exact', head: true })
        .eq(check.column, id);
      if ((count || 0) > 0) blockingReasons.push(check.label);
    }

    // Payroll run items nyantol lewat employees_master, bukan employees
    // langsung — cek terpisah kalau ada row master yang ter-link.
    if (masterIds.length > 0) {
      const { count: payrollItemCount } = await admin
        .from('payroll_run_items')
        .select('id', { count: 'exact', head: true })
        .in('employee_master_id', masterIds);
      if ((payrollItemCount || 0) > 0) blockingReasons.push('riwayat payroll run');
    }

    if (blockingReasons.length > 0) {
      return NextResponse.json(
        {
          error:
            'Employee ini sudah punya data historis (' +
            blockingReasons.join(', ') +
            ') yang wajib disimpan untuk keperluan payroll/pajak/audit. ' +
            'Gunakan "Nonaktifkan" alih-alih hapus permanen.',
          blockingReasons,
        },
        { status: 409 }
      );
    }

    // Aman dihapus — bersihkan child rows yang murni konfigurasi/akses
    // (tidak ada nilai historis yang perlu diretensi), baru hapus akunnya.
    await admin.from('employee_modules').delete().eq('employee_id', id);
    await admin.from('work_schedule').delete().eq('employee_id', id);
    if (masterIds.length > 0) {
      await admin.from('employees_master').delete().in('id', masterIds);
    }

    const { error: deleteError } = await admin.from('employees').delete().eq('id', id);
    if (deleteError) {
      return NextResponse.json(
        { error: 'Gagal menghapus data employee: ' + deleteError.message },
        { status: 500 }
      );
    }

    // Hapus akun Supabase Auth-nya juga (best-effort — kegagalan di sini
    // tidak dikembalikan sebagai error karena row employees sudah terhapus;
    // superadmin bisa hapus manual dari Supabase Dashboard kalau perlu).
    const authUserId = await findAuthUserIdByEmail(admin, target.email);
    if (authUserId) {
      await admin.auth.admin.deleteUser(authUserId);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}