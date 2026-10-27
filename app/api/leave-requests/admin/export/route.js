import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { hitungHariKerja, labelJenisCuti } from '@/lib/leave';
import { todayJakarta } from '@/lib/serverTime';

const STATUS_VALID = ['pending', 'approved', 'rejected', 'cancelled'];
const STATUS_LABEL = { pending: 'MENUNGGU', approved: 'DISETUJUI', rejected: 'DITOLAK', cancelled: 'DIBATALKAN' };

// GET /api/leave-requests/admin/export?status=pending
// Seluruh pengajuan cuti (bukan hanya satu halaman) untuk ekspor CSV di halaman
// Kelola Pengajuan Cuti. status = filter yang sedang aktif di halaman; kosong
// = 'pending' (sama dengan route daftar), 'all' = semua status.
//
// Dibaca lewat service role, jadi hak modul leave_request_admin dicek manual.
// Hanya kolom yang tampil di halaman yang dikirim (tanpa kolom gaji/kuota
// employees_master). Data diambil dengan fetchAllRows supaya tidak terpotong
// di batas 1.000 baris PostgREST.
export async function GET(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['leave_request_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') || 'pending';
    if (statusFilter !== 'all' && !STATUS_VALID.includes(statusFilter)) {
      return NextResponse.json({ error: 'Filter status tidak valid.' }, { status: 400 });
    }

    const [reqRes, empRes, schedRes] = await Promise.all([
      fetchAllRows(() => {
        let query = admin
          .from('leave_requests')
          .select('id, employee_id, jenis, tanggal_mulai, tanggal_selesai, status, alasan, rejection_reason, created_at');
        if (statusFilter !== 'all') query = query.eq('status', statusFilter);
        // Urutan sama dengan daftar di halaman (tanggal mulai terbaru dulu);
        // `id` ditambahkan fetchAllRows sebagai pemutus seri.
        return query
          .order('tanggal_mulai', { ascending: false })
          .order('created_at', { ascending: false });
      }),
      fetchAllRows(() => admin.from('employees').select('id, nama')),
      fetchAllRows(() => admin.from('work_schedule').select('employee_id, hari_kerja'), { orderKey: 'employee_id' }),
    ]);

    const firstError = reqRes.error || empRes.error || schedRes.error;
    if (firstError) {
      console.error('Ekspor kelola cuti error:', firstError);
      return NextResponse.json({ error: 'Gagal menyiapkan data ekspor cuti.' }, { status: 500 });
    }

    const namaById = Object.fromEntries((empRes.data || []).map((e) => [e.id, e.nama]));
    const hariKerjaById = Object.fromEntries((schedRes.data || []).map((s) => [s.employee_id, s.hari_kerja]));

    const rows = (reqRes.data || []).map((r) => ({
      nama: namaById[r.employee_id] || '',
      jenis: labelJenisCuti(r.jenis),
      tanggal_mulai: r.tanggal_mulai || '',
      tanggal_selesai: r.tanggal_selesai || '',
      hari_kerja: hitungHariKerja(r.tanggal_mulai, r.tanggal_selesai, hariKerjaById[r.employee_id]),
      status: STATUS_LABEL[r.status] || r.status || '',
      alasan: r.alasan || '',
      alasan_penolakan: r.rejection_reason || '',
      tanggal_pengajuan: r.created_at ? todayJakarta(new Date(r.created_at)) : '',
    }));

    await logActivity(admin, {
      userId: access.emp.id,
      aksi: 'ekspor_cuti',
      targetTable: 'leave_requests',
      detail: { status: statusFilter, jumlah_baris: rows.length },
    });

    return NextResponse.json({ rows });
  } catch (err) {
    console.error('Ekspor kelola cuti error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
