import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { batasPeriode, JENIS_HARI_LABEL, STATUS_LEMBUR_LABEL } from '@/lib/overtimeRules';

const STATUS_VALID = ['pending', 'approved', 'rejected', 'cancelled'];

function jamTeks(menit) {
  return Number((menit / 60).toFixed(2));
}

// GET /api/overtime-requests/admin/export?status=&periode=YYYY-MM
// Seluruh pengajuan lembur (bukan hanya satu halaman) untuk ekspor CSV di
// halaman Kelola Lembur. Filter sama dengan route daftar: status kosong/'all'
// = semua status; periode kosong = semua periode (berdasarkan tanggal lembur).
// Hak modul overtime_admin dicek manual karena memakai service role; data
// diambil dengan fetchAllRows supaya tidak terpotong di batas 1.000 baris.
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

    const [reqRes, empRes] = await Promise.all([
      fetchAllRows(() => {
        let query = admin
          .from('overtime_requests')
          .select('id, employee_id, approved_by, tanggal, jam_mulai, jam_selesai, durasi_menit, jam_disetujui, jenis_hari, alasan, status, rejection_reason');
        if (status !== 'all') query = query.eq('status', status);
        if (periode) {
          const { awal, awalBulanDepan } = batasPeriode(periode);
          query = query.gte('tanggal', awal).lt('tanggal', awalBulanDepan);
        }
        // Urutan sama dengan daftar di halaman; `id` ditambahkan fetchAllRows.
        return query
          .order('tanggal', { ascending: false })
          .order('created_at', { ascending: false });
      }),
      // Nama karyawan dibaca terpisah (bukan embed) karena tabel punya dua FK
      // ke employees (employee_id dan approved_by).
      fetchAllRows(() => admin.from('employees').select('id, nama')),
    ]);

    const firstError = reqRes.error || empRes.error;
    if (firstError) {
      console.error('Ekspor kelola lembur error:', firstError);
      return NextResponse.json({ error: 'Gagal menyiapkan data ekspor lembur.' }, { status: 500 });
    }

    const namaById = Object.fromEntries((empRes.data || []).map((e) => [e.id, e.nama]));

    const rows = (reqRes.data || []).map((r) => ({
      nama: namaById[r.employee_id] || '',
      tanggal: r.tanggal || '',
      jam_mulai: r.jam_mulai ? r.jam_mulai.slice(0, 5) : '',
      jam_selesai: r.jam_selesai ? r.jam_selesai.slice(0, 5) : '',
      durasi_jam: jamTeks(r.durasi_menit),
      // Jam disetujui hanya berarti untuk lembur yang disetujui.
      jam_disetujui: r.status === 'approved' && r.jam_disetujui !== null && r.jam_disetujui !== undefined
        ? Number(r.jam_disetujui)
        : '',
      jenis_hari: JENIS_HARI_LABEL[r.jenis_hari] || r.jenis_hari || '',
      alasan: r.alasan || '',
      status: STATUS_LEMBUR_LABEL[r.status] || r.status || '',
      alasan_penolakan: r.rejection_reason || '',
      diproses_oleh: r.approved_by ? (namaById[r.approved_by] || '') : '',
    }));

    await logActivity(admin, {
      userId: access.emp.id,
      aksi: 'ekspor_lembur',
      targetTable: 'overtime_requests',
      detail: { status, periode: periode || null, jumlah_baris: rows.length },
    });

    return NextResponse.json({ rows });
  } catch (err) {
    console.error('Ekspor kelola lembur error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
