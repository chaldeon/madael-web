import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { ambilKebijakanCuti, KOLOM_MASTER_CUTI } from '@/lib/leaveServer';
import { parsePageParams, isRangeNotSatisfiable } from '@/lib/pagination';

const STATUS_VALID = ['pending', 'approved', 'rejected', 'cancelled'];

// GET /api/leave-requests/admin?status=pending&page=1&pageSize=50
// Data untuk halaman Kelola Pengajuan Cuti: pengajuan (berhalaman) + data
// pendukung untuk baris di halaman itu (karyawan, jadwal kerja, kolom kuota
// employees_master) + kebijakan kuota. status kosong = 'pending'; 'all' = semua.
//
// Pengajuan dimuat per halaman (range + count), bukan seluruh riwayat, karena
// PostgREST memotong respons di 1.000 baris tanpa error. Urutan: tanggal mulai
// terbaru dulu (sama dengan urutan awal tabel di halaman).
//
// Dulu halaman ini membaca 4 tabel langsung dari browser. RLS employees_master
// dibatasi superadmin (isinya kolom gaji), jadi pemegang modul
// leave_request_admin yang bukan superadmin melihat data kosong. Di sini
// dibaca lewat service role (RLS tidak berlaku), maka hak modul dicek manual
// dan kolom yang dikirim dibatasi — kolom gaji TIDAK ikut.
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
    const { page, pageSize, from, to } = parsePageParams(searchParams);

    let reqQuery = admin.from('leave_requests').select('*', { count: 'exact' });
    if (statusFilter !== 'all') reqQuery = reqQuery.eq('status', statusFilter);
    reqQuery = reqQuery
      .order('tanggal_mulai', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    const [reqRes, policyRes, payrollAccess] = await Promise.all([
      reqQuery,
      ambilKebijakanCuti(admin),
      // Mengubah kebijakan kuota = hak modul Payroll (tempat jatah per karyawan diatur).
      requireModuleAccess(admin, ['payroll']),
    ]);

    // Halaman melewati akhir data (mis. halaman terakhir kosong setelah ada yang
    // diproses): bukan error — klien diminta kembali ke halaman 1.
    if (isRangeNotSatisfiable(reqRes.error)) {
      return NextResponse.json({ outOfRange: true, requests: [], total: 0, page, pageSize });
    }

    const firstError = reqRes.error || policyRes.error;
    if (firstError) {
      console.error('Muat data kelola cuti error:', firstError);
      return NextResponse.json({ error: 'Gagal memuat data pengajuan cuti.' }, { status: 500 });
    }

    const requests = reqRes.data || [];

    // Data pendukung hanya untuk karyawan pada halaman ini (<= pageSize id, jadi
    // `.in(...)` tetap pendek dan tidak menyentuh batas 1.000 baris).
    const empIds = Array.from(new Set(requests.map((r) => r.employee_id).filter(Boolean)));
    let employees = [];
    let schedules = [];
    let master = [];
    if (empIds.length > 0) {
      const [empRes, schedRes, masterRes] = await Promise.all([
        admin.from('employees').select('id, nama').in('id', empIds).order('nama'),
        admin.from('work_schedule').select('employee_id, hari_kerja').in('employee_id', empIds),
        admin
          .from('employees_master')
          .select(`${KOLOM_MASTER_CUTI}, linked_employee_id`)
          .in('linked_employee_id', empIds),
      ]);
      const supportError = empRes.error || schedRes.error || masterRes.error;
      if (supportError) {
        console.error('Muat data pendukung kelola cuti error:', supportError);
        return NextResponse.json({ error: 'Gagal memuat data pengajuan cuti.' }, { status: 500 });
      }
      employees = empRes.data || [];
      schedules = schedRes.data || [];
      master = masterRes.data || [];
    }

    return NextResponse.json({
      employees,
      requests,
      schedules,
      master,
      total: reqRes.count ?? 0,
      page,
      pageSize,
      kebijakan: policyRes.kebijakan,
      kebijakanVersi: policyRes.versi,
      bisaUbahKebijakan: !payrollAccess.error,
    });
  } catch (err) {
    console.error('Muat data kelola cuti error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
