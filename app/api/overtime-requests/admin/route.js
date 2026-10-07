import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { batasPeriode } from '@/lib/overtimeRules';

const STATUS_VALID = ['pending', 'approved', 'rejected', 'cancelled'];

// GET /api/overtime-requests/admin?status=&periode=YYYY-MM
// Semua pengajuan lembur untuk halaman Kelola Lembur. status kosong/'all' =
// semua status; periode kosong = semua periode (berdasarkan tanggal lembur).
// Hak modul overtime_admin dicek manual karena memakai service role.
export async function GET(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['overtime_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';
    const periode = searchParams.get('periode') || '';

    if (status !== 'all' && !STATUS_VALID.includes(status)) {
      return NextResponse.json({ error: 'Filter status tidak valid.' }, { status: 400 });
    }
    if (periode && !/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) {
      return NextResponse.json({ error: 'Format periode harus YYYY-MM.' }, { status: 400 });
    }

    let query = admin
      .from('overtime_requests')
      .select('*')
      .order('tanggal', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(500);
    if (status !== 'all') query = query.eq('status', status);
    if (periode) {
      const { awal, awalBulanDepan } = batasPeriode(periode);
      query = query.gte('tanggal', awal).lt('tanggal', awalBulanDepan);
    }

    const { data: rows, error } = await query;
    if (error) {
      console.error('Muat data kelola lembur error:', error);
      return NextResponse.json({ error: 'Gagal memuat data pengajuan lembur.' }, { status: 500 });
    }

    // Nama karyawan dibaca terpisah (bukan embed) karena tabel punya dua FK
    // ke employees (employee_id dan approved_by).
    const ids = Array.from(new Set((rows || []).flatMap((r) => [r.employee_id, r.approved_by]).filter(Boolean)));
    let namaById = {};
    if (ids.length > 0) {
      const { data: emps, error: empError } = await admin.from('employees').select('id, nama').in('id', ids);
      if (empError) {
        console.error('Muat nama karyawan lembur error:', empError);
        return NextResponse.json({ error: 'Gagal memuat data pengajuan lembur.' }, { status: 500 });
      }
      namaById = Object.fromEntries((emps || []).map((e) => [e.id, e.nama]));
    }

    return NextResponse.json({
      requests: (rows || []).map((r) => ({
        ...r,
        employee_nama: namaById[r.employee_id] || '—',
        approved_by_nama: r.approved_by ? (namaById[r.approved_by] || '—') : null,
      })),
    });
  } catch (err) {
    console.error('Muat data kelola lembur error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
