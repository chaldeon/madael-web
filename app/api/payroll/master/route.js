import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { friendlyError } from '@/lib/errorMessage';
import { logActivity } from '@/lib/activityLog';
import {
  MASTER_SELECT,
  validateMasterInput,
  cekRelasiMaster,
  samarkanUntukLog,
} from '@/lib/payrollMasterServer';

// GET /api/payroll/master
//
// Daftar employees_master untuk Payroll Manager (app/employee/payroll).
// Dulu dibaca langsung dari browser; kolom gaji, NPWP, rekening, dan BPJS
// semua karyawan hanya terlindungi RLS. Sekarang hak modul payroll dicek di
// server (superadmin lolos) sebelum data dikirim.
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

// POST /api/payroll/master
//   body: kolom form Payroll Manager (lihat PATCH /api/payroll/master/[id]);
//         `nama` wajib, kolom lain memakai default form kosong bila tidak dikirim.
//
// Tambah employee master. Dulu browser meng-insert ke employees_master langsung
// dan log-nya dikirim terpisah sesudahnya (tanpa id baris baru). Di sini hak
// modul payroll dicek, body divalidasi + di-whitelist, akun absensi dicek belum
// dipakai baris lain, dan penambahan dicatat server-side (tambah_employee_master)
// dengan id baris baru. NPWP, rekening, dan nomor BPJS di log disamarkan.
// Respons: { success, master } — status 201.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => null);
    const { values, error: validationError } = validateMasterInput(body, { create: true });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const relasiError = await cekRelasiMaster(admin, values);
    if (relasiError) {
      return NextResponse.json({ error: relasiError.error }, { status: relasiError.status });
    }

    const { data: inserted, error: insertError } = await admin
      .from('employees_master')
      .insert([values])
      .select(MASTER_SELECT)
      .single();
    if (insertError || !inserted) {
      // 23505 = akun absensi yang sama baru saja dipakai baris lain (unique index).
      if (insertError?.code === '23505') {
        return NextResponse.json({ error: 'Akun absensi ini sudah terhubung ke employee master lain.' }, { status: 409 });
      }
      return NextResponse.json(
        { error: `Gagal menyimpan data karyawan: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Tambah employees_master' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'tambah_employee_master',
      targetTable: 'employees_master',
      targetId: inserted.id,
      detail: { nama: inserted.nama, sesudah: samarkanUntukLog(values) },
    });

    return NextResponse.json({ success: true, master: inserted }, { status: 201 });
  } catch (err) {
    console.error('Tambah employees_master error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
