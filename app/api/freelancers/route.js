import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { insertFreelancerWithRetry } from '@/lib/freelancerId';
import { DEFAULT_FREELANCER_MODULE_ACCESS, FREELANCER_STATUS } from '@/lib/freelancerModules';
import {
  FREELANCER_SORT_COLUMNS,
  validateFreelancerInput,
  isValidFreelancerStatus,
} from '@/lib/freelancerAdminConfig';
import { gerbangFreelancerAdmin, cekEmailBelumDipakai, jsonError } from '@/lib/freelancerAdminServer';
import { parsePageParams, isRangeNotSatisfiable } from '@/lib/pagination';
import { sanitizeSearchTerm } from '@/lib/searchTerm';
import { logActivity } from '@/lib/activityLog';
import { friendlyError, friendlyAuthError } from '@/lib/errorMessage';

// Kolom daftar. Tanpa kolom sensitif (rekening, NPWP/NIK). `cv_url` hanya dipakai
// untuk menurunkan has_cv — nilainya (id file Drive) tidak dikirim ke browser.
const LIST_COLUMNS =
  'id, freelancer_code, nama_lengkap, email, no_whatsapp, status, tanggal_bergabung, cv_url, created_at';

// GET /api/freelancers?page=&pageSize=&q=&status=&sort=&dir=
// Daftar Freelancer berhalaman (server-side, .range() + count) untuk modul
// Kelola Freelancer. Dibaca lewat service role supaya tidak bergantung pada
// izin kolom role authenticated; aksesnya dijaga modul `freelancer_admin`.
export async function GET(request) {
  try {
    const admin = createAdminClient();
    const gate = await gerbangFreelancerAdmin(admin);
    if (gate.error) return jsonError(gate.error, gate.status);

    const sp = request.nextUrl.searchParams;
    const { page, pageSize, from, to } = parsePageParams(sp);

    const status = sp.get('status') || '';
    if (status && !isValidFreelancerStatus(status)) return jsonError('Filter status tidak valid.', 400);

    const sortParam = sp.get('sort') || '';
    const sort = FREELANCER_SORT_COLUMNS[sortParam] ? sortParam : 'freelancer_code';
    const ascending = (sp.get('dir') || (sort === 'freelancer_code' ? 'desc' : 'asc')) !== 'desc';

    let query = admin.from('freelancers').select(LIST_COLUMNS, { count: 'exact' });
    if (status) query = query.eq('status', status);

    const safeQ = sanitizeSearchTerm(sp.get('q') || '');
    if (safeQ) {
      query = query.or(
        `nama_lengkap.ilike.%${safeQ}%,email.ilike.%${safeQ}%,freelancer_code.ilike.%${safeQ}%,no_whatsapp.ilike.%${safeQ}%`
      );
    }

    // `id` sebagai pemutus seri supaya urutan antar halaman deterministik.
    query = query.order(sort, { ascending }).order('id', { ascending: true });

    const { data, error, count } = await query.range(from, to);
    if (error) {
      // Halaman melewati akhir data (mis. daftar menyusut): bukan error bagi admin.
      if (isRangeNotSatisfiable(error)) {
        return NextResponse.json({ freelancers: [], totalCount: 0, page, pageSize, outOfRange: true }, { status: 200 });
      }
      console.error('Daftar Freelancer gagal dimuat:', error);
      return jsonError(friendlyError(error, 'Gagal memuat daftar Freelancer.', { context: 'Muat daftar Freelancer' }), 500);
    }

    const freelancers = (data || []).map(({ cv_url, ...row }) => ({
      ...row,
      has_cv: !!cv_url,
      // Status Agreement diisi di A3 (tabel Agreement belum ada); null = belum tersedia.
      agreement_status: null,
    }));

    return NextResponse.json({ freelancers, totalCount: count || 0, page, pageSize }, { status: 200 });
  } catch (err) {
    console.error('GET /api/freelancers error:', err);
    return jsonError('Terjadi kesalahan server.', 500);
  }
}

// POST /api/freelancers
// Buat akun Freelancer: validasi -> cek email unik lintas employees+freelancers ->
// undangan email (inviteUserByEmail, pola /api/employee/create) -> baris
// freelancers dengan FL-ID otomatis -> modul default. Gagal setelah undangan =
// rollback (hapus baris + akun Auth) supaya tidak ada akun yatim.
// Body JSON: { nama_lengkap, email, no_whatsapp?, alamat?, tanggal_bergabung? }
// CV diunggah terpisah lewat POST /api/freelancers/[id]/cv (multipart).
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const gate = await gerbangFreelancerAdmin(admin);
    if (gate.error) return jsonError(gate.error, gate.status);
    const { emp } = gate;

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Data yang dikirim tidak valid.', 400);
    }

    const { error: validationError, values } = validateFreelancerInput(body, { mode: 'create' });
    if (validationError) return jsonError(validationError, 400);

    const emailPesan = await cekEmailBelumDipakai(admin, values.email);
    if (emailPesan) return jsonError(emailPesan, 409);

    // Undangan email: Supabase mengirim link set-password (SMTP project Supabase);
    // Freelancer membuat password sendiri di /employee/set-password. Tidak ada
    // password sementara. Login-nya sama dengan karyawan (/employee/login).
    const { data: authUser, error: authError } = await admin.auth.admin.inviteUserByEmail(values.email, {
      redirectTo: `${request.nextUrl.origin}/employee/set-password`,
      data: { nama: values.nama_lengkap, tipe_akun: 'freelancer' },
    });
    if (authError) {
      return jsonError(
        'Gagal membuat akun login: ' + friendlyAuthError(authError, 'terjadi kesalahan pada server.', { context: 'Undang Freelancer' }),
        500
      );
    }
    const authUserId = authUser.user.id;

    const hapusAkunAuth = async () => {
      try {
        const { error } = await admin.auth.admin.deleteUser(authUserId);
        if (error) throw error;
        return true;
      } catch (err) {
        console.error('Rollback akun Auth Freelancer gagal:', authUserId, err);
        return false;
      }
    };

    const row = {
      auth_user_id: authUserId,
      nama_lengkap: values.nama_lengkap,
      email: values.email,
      no_whatsapp: values.no_whatsapp,
      alamat: values.alamat,
      status: FREELANCER_STATUS.ACTIVE,
    };
    // Kosong = default database (current_date).
    if (values.tanggal_bergabung) row.tanggal_bergabung = values.tanggal_bergabung;

    const { data: created, error: insertError } = await insertFreelancerWithRetry(admin, row);
    if (insertError || !created) {
      const authDihapus = await hapusAkunAuth();
      const catatan = authDihapus ? '' : ' Akun login yang sempat dibuat gagal dihapus otomatis; hapus manual dari Supabase Dashboard > Authentication.';
      if (insertError?.code === '23505') {
        return jsonError('Email atau akun ini sudah terdaftar sebagai Freelancer/karyawan.' + catatan, 409);
      }
      return jsonError(
        'Gagal menyimpan data Freelancer: ' + friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Simpan data Freelancer' }) + catatan,
        500
      );
    }

    const { error: modulesError } = await admin
      .from('freelancer_modules')
      .insert(DEFAULT_FREELANCER_MODULE_ACCESS.map((module_name) => ({ freelancer_id: created.id, module_name })));
    if (modulesError) {
      // Baris freelancers baru dibuat di request ini; menghapusnya (modul ikut
      // CASCADE) mengembalikan keadaan seperti sebelum request.
      let rollbackOk = true;
      const { error: delError } = await admin.from('freelancers').delete().eq('id', created.id);
      if (delError) {
        rollbackOk = false;
        console.error('Rollback baris Freelancer gagal:', created.id, delError);
      }
      const authDihapus = await hapusAkunAuth();
      const catatan = rollbackOk && authDihapus
        ? ''
        : ` Pembersihan otomatis belum tuntas (data ${created.freelancer_code} dan/atau akun login ${values.email}); hubungi pengembang sebelum mencoba lagi.`;
      return jsonError(
        'Gagal memberi akses modul default: ' + friendlyError(modulesError, 'terjadi kesalahan pada server.', { context: 'Modul default Freelancer' }) + catatan,
        500
      );
    }

    // Fire-and-forget — gagal mencatat log tidak boleh membatalkan akun yang sudah jadi.
    logActivity(admin, {
      userId: emp.id,
      aksi: 'tambah_freelancer',
      targetTable: 'freelancers',
      targetId: created.id,
      detail: {
        freelancer_code: created.freelancer_code,
        nama_lengkap: created.nama_lengkap,
        email: created.email,
      },
    });

    return NextResponse.json(
      {
        success: true,
        invited: true,
        freelancer: {
          id: created.id,
          freelancer_code: created.freelancer_code,
          nama_lengkap: created.nama_lengkap,
          email: created.email,
          status: created.status,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('POST /api/freelancers error:', err);
    return jsonError('Terjadi kesalahan server.', 500);
  }
}
