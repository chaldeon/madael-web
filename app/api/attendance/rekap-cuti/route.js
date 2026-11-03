import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { friendlyError } from '@/lib/errorMessage';
import { monthBounds } from '@/lib/attendanceSummary';

export const dynamic = 'force-dynamic';

// GET /api/attendance/rekap-cuti?month=YYYY-MM
//
// Dipakai Rekap Bulanan absensi admin (app/employee/absensi/rekap) supaya hari
// kerja yang tertutup cuti/sakit/izin yang SUDAH DISETUJUI tidak dihitung
// "Tidak Hadir" (aturan yang sama dengan halaman "Absensi Saya").
//
// Pengajuan cuti milik karyawan lain dibaca lewat service role di server, bukan
// dari browser, supaya rekap tidak bergantung pada kebijakan RLS leave_requests.
// Hak akses: modul absensi_admin (superadminOnly di registry, jadi hanya
// superadmin — sama dengan halaman rekapnya).
//
// Respons: { leaves: [{ employee_id, tanggal_mulai, tanggal_selesai }] } —
// hanya status approved yang beririsan dengan bulan itu; tanpa alasan atau
// lampiran.
export async function GET(request) {
  try {
    const month = new URL(request.url).searchParams.get('month') || '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: 'Parameter month harus berformat YYYY-MM.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['absensi_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { firstDay, lastDay } = monthBounds(month);
    const { data, error } = await fetchAllRows(() =>
      admin
        .from('leave_requests')
        .select('employee_id, tanggal_mulai, tanggal_selesai')
        .eq('status', 'approved')
        .lte('tanggal_mulai', lastDay)
        .gte('tanggal_selesai', firstDay)
    );
    if (error) {
      return NextResponse.json(
        { error: `Gagal memuat cuti disetujui: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Muat cuti untuk rekap absensi' })}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ leaves: data || [] });
  } catch (err) {
    console.error('Rekap cuti error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
