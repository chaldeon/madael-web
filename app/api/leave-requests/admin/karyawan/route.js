import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN } from '@/lib/leave';

// GET /api/leave-requests/admin/karyawan
// Daftar karyawan aktif (id + nama saja) untuk pilihan "Catat atas nama
// karyawan" di halaman Kelola Pengajuan Cuti. Dibaca lewat service role,
// jadi hak modul leave_request_admin dicek manual. Akun pemanggil sendiri
// tidak ikut daftar (tidak boleh mencatat untuk diri sendiri; lihat
// POST /api/leave-requests/admin).
export async function GET() {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['leave_request_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const { data, error } = await fetchAllRows(() =>
      admin.from('employees').select('id, nama').eq('status', 'Aktif').order('nama')
    );
    if (error) {
      console.error('Muat daftar karyawan (input cuti HR) error:', error);
      return NextResponse.json({ error: 'Gagal memuat daftar karyawan.' }, { status: 500 });
    }

    const boleh = SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN && emp.is_superadmin;
    const employees = (data || []).filter((e) => boleh || e.id !== emp.id);
    return NextResponse.json({ employees });
  } catch (err) {
    console.error('Muat daftar karyawan (input cuti HR) error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
