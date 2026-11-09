import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import {
  MASTER_SELECT,
  validateMasterInput,
  cekRelasiMaster,
  diffMaster,
  samarkanUntukLog,
} from '@/lib/payrollMasterServer';

// PATCH /api/payroll/master/[id]
//   body: salah satu/semua kolom form Payroll Manager — nama, client_id, posisi,
//         status, gaji_pokok, tunjangan, komponen_lain, linked_employee_id,
//         status_ptkp, npwp_status, npwp, jkk_rate, no_bpjs_kesehatan,
//         no_bpjs_ketenagakerjaan, nama_rekening, no_rekening, nama_bank,
//         jatah_cuti_tahunan, cuti_carry_over, tanggal_bergabung,
//         jenis_hubungan_kerja, kontrak_berakhir. Parsial: hanya key yang
//         dikirim yang diubah (halaman detail Employee List hanya mengirim
//         tujuh di antaranya).
//
// Jalan resmi mengubah data HR/payroll karyawan dari UI. Dulu browser meng-update
// tabel ini langsung (form lengkap di app/employee/payroll/page.js): validasi hanya
// di klien, log dikirim sesudah write dan tanpa nilai sebelum→sesudah. Di sini
// hak modul payroll dicek, body divalidasi + di-whitelist (lib/payrollMasterServer.js),
// dan perubahan dicatat server-side sebagai edit_struktur_gaji. NPWP, rekening,
// dan nomor BPJS di log disamarkan (4 digit akhir). Bila tidak ada nilai yang
// berubah, tidak ada UPDATE dan tidak ada log.

// GET /api/payroll/master/[id]
//
// Detail satu baris employees_master untuk halaman detail Payroll
// (app/employee/payroll/[id]). Dulu dibaca langsung dari browser (select *,
// termasuk gaji, NPWP, rekening); sekarang hak modul payroll dicek di server.
// Respons: { data } — baris master + companies:client_id ( nama_perusahaan ).
export async function GET(_request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { data, error } = await admin
      .from('employees_master')
      .select('*, companies:client_id ( nama_perusahaan )')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      if (error.code === '22P02') {
        return NextResponse.json({ error: 'Data employee tidak ditemukan.' }, { status: 404 });
      }
      return NextResponse.json(
        { error: `Gagal memuat data employee: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Muat employees_master' })}` },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: 'Data employee tidak ditemukan.' }, { status: 404 });
    }

    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => null);

    const { data: before, error: beforeError } = await admin
      .from('employees_master')
      .select(MASTER_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (beforeError) {
      if (beforeError.code === '22P02') {
        return NextResponse.json({ error: 'Data employee tidak ditemukan.' }, { status: 404 });
      }
      return NextResponse.json(
        { error: `Gagal memuat data employee: ${friendlyError(beforeError, 'terjadi kesalahan pada server.', { context: 'Muat employees_master' })}` },
        { status: 500 }
      );
    }
    if (!before) {
      return NextResponse.json({ error: 'Data employee tidak ditemukan.' }, { status: 404 });
    }

    const { values, error: validationError } = validateMasterInput(body, { create: false, before });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const relasiError = await cekRelasiMaster(admin, values, { masterId: id, before });
    if (relasiError) {
      return NextResponse.json({ error: relasiError.error }, { status: relasiError.status });
    }

    const { sebelum, sesudah } = diffMaster(before, values);
    if (Object.keys(sesudah).length === 0) {
      return NextResponse.json({ success: true, unchanged: true, master: before });
    }

    const { data: updated, error: updateError } = await admin
      .from('employees_master')
      .update(values)
      .eq('id', id)
      .select(MASTER_SELECT)
      .maybeSingle();
    if (updateError) {
      // 23505 = akun absensi yang sama baru saja dipakai baris lain (unique index).
      if (updateError.code === '23505') {
        return NextResponse.json({ error: 'Akun absensi ini sudah terhubung ke employee master lain.' }, { status: 409 });
      }
      return NextResponse.json(
        { error: `Gagal menyimpan data HR/payroll: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Ubah employees_master' })}` },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json({ error: 'Data employee tidak ditemukan.' }, { status: 404 });
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'edit_struktur_gaji',
      targetTable: 'employees_master',
      targetId: id,
      detail: { nama: updated.nama, sebelum: samarkanUntukLog(sebelum), sesudah: samarkanUntukLog(sesudah) },
    });

    return NextResponse.json({ success: true, master: updated });
  } catch (err) {
    console.error('Ubah employees_master error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
