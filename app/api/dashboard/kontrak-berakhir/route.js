import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { todayJakarta } from '@/lib/serverTime';
import { KONTRAK_PERINGATAN_HARI, tambahHari, statusKontrak } from '@/lib/kepegawaian';
import { friendlyError } from '@/lib/errorMessage';

// GET /api/dashboard/kontrak-berakhir
//
// Widget "Kontrak berakhir" di dashboard HRIS: karyawan PKWT/Magang yang
// kontraknya berakhir dalam KONTRAK_PERINGATAN_HARI hari ke depan, ditambah
// yang tanggalnya sudah lewat tetapi masih aktif (kontrak belum diperpanjang
// atau tanggalnya belum diperbarui HR).
//
// Hak akses: modul employee_list atau payroll (superadmin lolos). Query
// memakai service role karena RLS employees_master tidak berlaku di sini,
// jadi hak modul dicek manual lewat requireModuleAccess.
// Respons: { today, thresholdDays, total, berakhir, segera, items: [...] }
// `items` dibatasi MAX_ITEMS, urut dari tanggal berakhir paling awal.
const MAX_ITEMS = 20;

export async function GET() {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['employee_list', 'payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const today = todayJakarta();
    const batas = tambahHari(today, KONTRAK_PERINGATAN_HARI);

    const { data, error } = await admin
      .from('employees_master')
      .select(
        'id, nama, posisi, jenis_hubungan_kerja, kontrak_berakhir, linked_employee_id, employees:linked_employee_id ( id, status ), companies:client_id ( nama_perusahaan )'
      )
      .not('kontrak_berakhir', 'is', null)
      .lte('kontrak_berakhir', batas)
      .order('kontrak_berakhir', { ascending: true });
    if (error) {
      return NextResponse.json(
        { error: `Gagal memuat kontrak berakhir: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Muat kontrak berakhir' })}` },
        { status: 500 }
      );
    }

    // Akun yang sudah dinonaktifkan tidak perlu diingatkan. Baris payroll-only
    // (tanpa akun) tetap ikut.
    const rows = (data || []).filter((r) => !r.employees || r.employees.status === 'Aktif');

    const items = rows.map((r) => {
      const status = statusKontrak(r.kontrak_berakhir, today);
      let href;
      if (r.linked_employee_id) href = `/employee/list/${r.linked_employee_id}`;
      else href = emp.is_superadmin ? `/employee/payroll/${r.id}` : '/employee/payroll';
      return {
        id: r.id,
        nama: r.nama,
        posisi: r.posisi || null,
        perusahaan: r.companies?.nama_perusahaan || null,
        jenis: r.jenis_hubungan_kerja || null,
        kontrak_berakhir: r.kontrak_berakhir,
        sisa_hari: status.sisaHari,
        kind: status.kind,
        href,
      };
    });

    return NextResponse.json({
      today,
      thresholdDays: KONTRAK_PERINGATAN_HARI,
      total: items.length,
      berakhir: items.filter((i) => i.kind === 'berakhir').length,
      segera: items.filter((i) => i.kind === 'segera').length,
      items: items.slice(0, MAX_ITEMS),
    });
  } catch (err) {
    console.error('Muat kontrak berakhir error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
