import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import {
  validatePayslipInput,
  ambilNomorSlip,
  kembalikanNomorSlip,
  SNAPSHOT_KEYS,
} from '@/lib/payslipServer';

// POST /api/payslips
//   body: { employee_id, periode: 'YYYY-MM', gaji_pokok, lembur, ... (nominal),
//           metode_pembayaran?, tanggal_pembayaran?,
//           rekening?, npwp?, ptkp?, no_bpjs_k?, no_bpjs_tk? }
//
// Satu-satunya jalan membuat slip gaji dari form Kelola Slip Gaji. Dulu browser
// meng-insert ke payslips langsung: nomor dokumen (counter INV) diambil SEBELUM
// insert sehingga hangus kalau insert gagal, validasi nominal hanya di klien,
// dan pembuatan slip tidak tercatat di activity log.
//
// Di sini: hak modul payslip_admin dicek, body divalidasi + di-whitelist,
// nomor dokumen diambil HANYA setelah semua validasi dan pengecekan karyawan
// lolos, nomor dikembalikan ke counter bila insert tetap gagal, dan pembuatan
// slip dicatat server-side (buat_slip_gaji). Slip selalu dibuat sebagai Draft;
// menerbitkan hanya lewat /api/payslips/[id]/publish.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payslip_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => null);
    const { values, error: validationError } = validatePayslipInput(body, { create: true });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { data: employee, error: employeeError } = await admin
      .from('employees')
      .select('id, nama')
      .eq('id', values.employee_id)
      .maybeSingle();
    if (employeeError && employeeError.code !== '22P02') {
      return NextResponse.json(
        { error: `Gagal memeriksa karyawan: ${friendlyError(employeeError, 'terjadi kesalahan pada server.', { context: 'Cek karyawan slip gaji' })}` },
        { status: 500 }
      );
    }
    // 22P02 = employee_id bukan format id yang valid
    if (employeeError || !employee) {
      return NextResponse.json({ error: 'Karyawan tidak ditemukan.' }, { status: 400 });
    }

    // Semua validasi sudah lolos — baru sekarang nomor diambil.
    let nomorSlip;
    try {
      nomorSlip = await ambilNomorSlip(admin);
    } catch (err) {
      return NextResponse.json(
        { error: `Gagal generate nomor dokumen: ${friendlyError(err, 'terjadi kesalahan pada server.', { context: 'Generate nomor slip gaji' })}` },
        { status: 500 }
      );
    }

    const { data: inserted, error: insertError } = await admin
      .from('payslips')
      .insert([{ ...values, nomor_dokumen: nomorSlip.nomor, is_published: false }])
      .select('id')
      .single();

    if (insertError || !inserted) {
      const dikembalikan = await kembalikanNomorSlip(admin, nomorSlip.urutan);
      if (!dikembalikan) {
        // Nomor sudah diambil pihak lain sesudahnya (atau counter tidak bisa
        // diubah) sehingga jadi celah di urutan; dicatat supaya bisa dijelaskan.
        await logActivity(admin, {
          userId: emp.id,
          aksi: 'nomor_slip_hangus',
          targetTable: 'document_counters',
          detail: { nomor_dokumen: nomorSlip.nomor, employee_id: values.employee_id, periode: values.periode },
        });
      }
      return NextResponse.json(
        { error: `Gagal menyimpan slip gaji: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Buat slip gaji' })}` },
        { status: 500 }
      );
    }

    // Data snapshot (rekening, NPWP, dst.) tidak ikut ke log — cukup nominal,
    // periode, dan metode/tanggal pembayaran.
    const sesudah = { ...values };
    for (const key of SNAPSHOT_KEYS) delete sesudah[key];
    delete sesudah.employee_id;
    await logActivity(admin, {
      userId: emp.id,
      aksi: 'buat_slip_gaji',
      targetTable: 'payslips',
      targetId: inserted.id,
      detail: {
        employee_id: employee.id,
        nama: employee.nama,
        nomor_dokumen: nomorSlip.nomor,
        sesudah,
      },
    });

    return NextResponse.json({ success: true, id: inserted.id, nomor_dokumen: nomorSlip.nomor });
  } catch (err) {
    console.error('Buat slip gaji error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
