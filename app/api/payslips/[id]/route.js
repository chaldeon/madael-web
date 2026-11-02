import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { validatePayslipInput, diffPayslip, EDIT_SELECT } from '@/lib/payslipServer';

const PESAN_TERKUNCI =
  'Slip gaji ini sudah terbit dan tidak bisa diedit langsung. Tarik dulu slip ini (kembalikan ke Draft), lalu edit.';

// PATCH /api/payslips/[id]
//   body (parsial): { periode?, gaji_pokok?, lembur?, ... (nominal),
//                     metode_pembayaran?, tanggal_pembayaran? }
//
// Satu-satunya jalan mengubah slip gaji dari form Kelola Slip Gaji. Dulu
// browser meng-update payslips langsung: slip yang sudah Published (sudah
// dilihat karyawan) bisa diubah nominalnya tanpa jejak.
//
// Di sini: hak modul payslip_admin dicek, hanya kolom di whitelist yang
// diterima (employee_id, nomor_dokumen, data snapshot, dan is_published tidak
// bisa diubah lewat sini), slip yang sudah terbit DITOLAK (409) — harus ditarik
// dulu lewat /api/payslips/[id]/publish yang juga tercatat — dan perubahan
// (sebelum -> sesudah) dicatat server-side sebagai ubah_slip_gaji.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payslip_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const { data: before, error: beforeError } = await admin
      .from('payslips')
      .select(`${EDIT_SELECT}, employees ( nama )`)
      .eq('id', id)
      .maybeSingle();
    if (beforeError) {
      // 22P02 = id bukan format yang valid untuk kolom id
      if (beforeError.code === '22P02') {
        return NextResponse.json({ error: 'Slip gaji tidak ditemukan.' }, { status: 404 });
      }
      return NextResponse.json(
        { error: `Gagal memuat slip gaji: ${friendlyError(beforeError, 'terjadi kesalahan pada server.', { context: 'Muat slip gaji' })}` },
        { status: 500 }
      );
    }
    if (!before) {
      return NextResponse.json({ error: 'Slip gaji tidak ditemukan.' }, { status: 404 });
    }
    if (before.is_published) {
      return NextResponse.json({ error: PESAN_TERKUNCI, terkunci: true }, { status: 409 });
    }

    const body = await request.json().catch(() => null);
    const { values, error: validationError } = validatePayslipInput(body, { create: false, base: before });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { sebelum, sesudah } = diffPayslip(before, values);
    if (Object.keys(sesudah).length === 0) {
      // Tidak ada yang benar-benar berubah: tidak ada write, tidak ada log.
      return NextResponse.json({ success: true, changed: false });
    }

    // Update bersyarat pada is_published=false: kalau slip diterbitkan oleh
    // admin lain di antara pembacaan di atas dan update ini, edit ditolak
    // alih-alih menimpa slip yang sudah terbit.
    const { data: updated, error: updateError } = await admin
      .from('payslips')
      .update(values)
      .eq('id', id)
      .eq('is_published', false)
      .select('id')
      .maybeSingle();
    if (updateError) {
      return NextResponse.json(
        { error: `Gagal menyimpan slip gaji: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Ubah slip gaji' })}` },
        { status: 500 }
      );
    }
    if (!updated) {
      const { data: current } = await admin
        .from('payslips')
        .select('is_published')
        .eq('id', id)
        .maybeSingle();
      if (!current) {
        return NextResponse.json({ error: 'Slip gaji tidak ditemukan.' }, { status: 404 });
      }
      return NextResponse.json({ error: PESAN_TERKUNCI, terkunci: true }, { status: 409 });
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_slip_gaji',
      targetTable: 'payslips',
      targetId: id,
      detail: {
        employee_id: before.employee_id,
        nama: before.employees?.nama || null,
        nomor_dokumen: before.nomor_dokumen,
        sebelum,
        sesudah,
      },
    });

    return NextResponse.json({ success: true, changed: true });
  } catch (err) {
    console.error('Ubah slip gaji error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
