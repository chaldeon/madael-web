import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { nextEmployeeId } from '@/lib/employeeId';
import { logActivity } from '@/lib/activityLog';
import { friendlyError, friendlyAuthError } from '@/lib/errorMessage';
import { lengkapiSetupKaryawan } from '@/lib/employeeSetup';

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
      .select('id, is_superadmin')
      .eq('email', user.email)
      .maybeSingle();

    if (!requester?.is_superadmin) {
      return NextResponse.json(
        { error: 'Hanya superadmin yang boleh menambah employee.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { nama, email, client_id, status, is_superadmin } = body;
    let { employee_id } = body;

    // Email = identitas login. Supabase Auth menyimpan email dalam huruf kecil
    // dan semua lookup `.eq('email', user.email)` membandingkan persis, jadi
    // email WAJIB dinormalisasi (trim + lowercase) sebelum dipakai di Auth
    // maupun tabel employees — sama seperti bulk-create.
    const emailNorm = String(email ?? '').trim().toLowerCase();

    if (!nama || !emailNorm) {
      return NextResponse.json({ error: 'Nama dan email wajib diisi.' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Employee ID kosong -> auto-generate format MDL0001 (4 digit, muat
    // sampai ribuan) berdasarkan employee_id tertinggi yang sudah ada.
    employee_id = employee_id?.trim();
    if (!employee_id) {
      const { data: existing } = await admin.from('employees').select('employee_id');
      employee_id = nextEmployeeId((existing || []).map((e) => e.employee_id));
    }

    // Undangan email — Supabase yang generate & kirim link set-password ke
    // employee baru (via SMTP yang dikonfigurasi di project Supabase). Tidak
    // ada password sementara yang perlu ditangani/ditampilkan admin lagi;
    // employee klik link di email lalu diarahkan ke /employee/set-password
    // untuk buat password sendiri. Lihat juga: middleware.js (path ini wajib
    // masuk PUBLIC_EMPLOYEE_PATHS) dan app/employee/set-password/page.js.
    const { data: authUser, error: authError } = await admin.auth.admin.inviteUserByEmail(emailNorm, {
      redirectTo: `${request.nextUrl.origin}/employee/set-password`,
      data: { nama, employee_id },
    });

    if (authError) {
      return NextResponse.json(
        { error: 'Gagal membuat akun Auth: ' + friendlyAuthError(authError, 'terjadi kesalahan pada server.', { context: 'Buat akun Auth' }) },
        { status: 500 }
      );
    }

    const { data: empRow, error: empError } = await admin
      .from('employees')
      .insert([
        {
          nama,
          employee_id,
          email: emailNorm,
          client_id: client_id || null,
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
        { error: 'Gagal menyimpan data employee: ' + friendlyError(empError, 'terjadi kesalahan pada server.', { context: 'Simpan data employee', showField: true }) },
        { status: 500 }
      );
    }

    // Setup akun: akses modul default (employee non-superadmin; superadmin sudah
    // otomatis punya semua modul) + satu baris employees_master draft yang
    // langsung ter-link, supaya admin tidak perlu lagi pilih dari dropdown
    // "Nama" di Payroll Manager (Fase 3.1). Kegagalan di sini tidak fatal —
    // employee tetap berhasil dibuat — tapi DILAPORKAN ke HR lewat `warnings`
    // (ditampilkan di Employee List, lengkap dengan aksi "Perbaiki Setup Akun"),
    // bukan cuma console.error. Lihat lib/employeeSetup.js.
    const setup = await lengkapiSetupKaryawan(admin, empRow, { baru: true });

    // Fire-and-forget — kegagalan mencatat log tidak boleh menggagalkan
    // pembuatan employee yang sudah berhasil.
    logActivity(admin, {
      userId: requester.id,
      aksi: 'tambah_employee',
      targetTable: 'employees',
      targetId: empRow.id,
      detail: {
        nama: empRow.nama,
        email: empRow.email,
        is_superadmin: empRow.is_superadmin,
        ...(setup.warnings.length > 0 ? { setup_gagal: setup.warnings.map((w) => w.kode) } : {}),
      },
    });

    return NextResponse.json(
      { success: true, employee: empRow, invited: true, warnings: setup.warnings },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}