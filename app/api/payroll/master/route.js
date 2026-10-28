import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { friendlyError } from '@/lib/errorMessage';

// GET /api/payroll/master
//
// Daftar employees_master untuk Payroll Manager (app/employee/payroll).
// Dulu dibaca langsung dari browser; kolom gaji, NPWP, rekening, dan BPJS
// semua karyawan hanya terlindungi RLS. Sekarang hak modul payroll dicek di
// server (superadmin lolos) sebelum data dikirim. Penulisan (tambah/edit)
// belum dipindah — itu cakupan item lain.
//
// fetchAllRows: PostgREST memotong diam-diam di 1.000 baris; tanpa ini tabel
// bisa kekurangan karyawan tanpa tanda apa pun.
// Respons: { data: [...] } — urut created_at terbaru dulu.
const MASTER_COLUMNS =
  'id, nama, client_id, posisi, status, tanggal_bergabung, jenis_hubungan_kerja, kontrak_berakhir, gaji_pokok, tunjangan, komponen_lain, linked_employee_id, status_ptkp, npwp_status, npwp, jkk_rate, no_bpjs_kesehatan, no_bpjs_ketenagakerjaan, nama_rekening, no_rekening, jatah_cuti_tahunan, cuti_terpakai, cuti_terpakai_tahun, cuti_carry_over, cuti_carry_over_tahun, created_at, drive_file_id, drive_file_name, drive_file_link, employees:linked_employee_id ( nama )';

export async function GET() {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { data, error } = await fetchAllRows(
      () => admin.from('employees_master').select(MASTER_COLUMNS).order('created_at', { ascending: false })
    );
    if (error) {
      return NextResponse.json(
        { error: `Gagal memuat data karyawan: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Muat daftar employees_master' })}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
