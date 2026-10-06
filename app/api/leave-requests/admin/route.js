import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';

// GET /api/leave-requests/admin
// Data untuk halaman Kelola Pengajuan Cuti: semua pengajuan + daftar karyawan
// + jadwal kerja + kolom kuota employees_master.
//
// Dulu halaman ini membaca 4 tabel langsung dari browser. RLS employees_master
// dibatasi superadmin (isinya kolom gaji), jadi pemegang modul
// leave_request_admin yang bukan superadmin melihat data kosong. Di sini
// dibaca lewat service role (RLS tidak berlaku), maka hak modul dicek manual
// dan kolom yang dikirim dibatasi — kolom gaji TIDAK ikut.
export async function GET() {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['leave_request_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const [empRes, reqRes, schedRes, masterRes] = await Promise.all([
      admin.from('employees').select('id, nama').order('nama'),
      admin.from('leave_requests').select('*').order('created_at', { ascending: false }),
      admin.from('work_schedule').select('employee_id, hari_kerja'),
      admin
        .from('employees_master')
        .select('id, linked_employee_id, jatah_cuti_tahunan, cuti_terpakai, cuti_terpakai_tahun'),
    ]);

    const firstError = empRes.error || reqRes.error || schedRes.error || masterRes.error;
    if (firstError) {
      console.error('Muat data kelola cuti error:', firstError);
      return NextResponse.json({ error: 'Gagal memuat data pengajuan cuti.' }, { status: 500 });
    }

    return NextResponse.json({
      employees: empRes.data || [],
      requests: reqRes.data || [],
      schedules: schedRes.data || [],
      master: masterRes.data || [],
    });
  } catch (err) {
    console.error('Muat data kelola cuti error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
