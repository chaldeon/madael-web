import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { todayJakarta } from '@/lib/serverTime';
import {
  INVOICE_STATUS_VALID,
  cekTransisiInvoice,
  validateStatusBody,
} from '@/lib/documentServer';

// PATCH /api/invoices/[id]/status
//   body: { status: 'draft' | 'terkirim' | 'lunas' }
//
// Ubah status invoice dari Invoice & Billing Tracker (khusus superadmin, sama
// dengan halamannya). Dulu browser meng-update tabel invoices langsung:
// tanpa validasi transisi, tanpa pemeriksaan hak di server, dan tanpa jejak
// siapa yang melunasi invoice.
//
// Aturan di sini:
// - hanya superadmin;
// - status harus salah satu dari draft/terkirim/lunas; 'lunas' tidak boleh
//   langsung kembali ke 'draft' (boleh ke 'terkirim');
// - tanggal_lunas diisi hari ini (WIB) saat menjadi lunas (kalau belum ada)
//   dan dikosongkan saat keluar dari lunas — sama dengan perilaku sebelumnya;
// - update bersyarat pada status lama: kalau sementara itu status sudah diubah
//   pihak lain, ditolak (409) supaya perubahan orang lain tidak tertimpa;
// - setiap perubahan tercatat di activity log (sebelum → sesudah).
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

    const session = await getSessionEmployee('id, nama, status, is_superadmin');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { emp } = session;
    if (!emp.is_superadmin) {
      return NextResponse.json(
        { error: 'Hanya superadmin yang boleh mengubah status invoice.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    const { status: statusBaru, error: validationError } = validateStatusBody(body, INVOICE_STATUS_VALID, 'invoice');
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: invoice, error: invError } = await admin
      .from('invoices')
      .select('id, nomor_surat, nominal, status, tanggal_lunas')
      .eq('id', id)
      .maybeSingle();
    if (invError && invError.code !== '22P02') {
      return NextResponse.json(
        { error: `Gagal memuat invoice: ${friendlyError(invError, 'terjadi kesalahan pada server.', { context: 'Muat invoice untuk ubah status' })}` },
        { status: 500 }
      );
    }
    if (invError || !invoice) {
      return NextResponse.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
    }

    const transisiError = cekTransisiInvoice(invoice.status, statusBaru);
    if (transisiError) {
      return NextResponse.json({ error: transisiError }, { status: 400 });
    }

    const patch = { status: statusBaru, updated_at: new Date().toISOString() };
    if (statusBaru === 'lunas') {
      patch.tanggal_lunas = invoice.tanggal_lunas || todayJakarta();
    } else {
      patch.tanggal_lunas = null;
    }

    const { data: updated, error: updateError } = await admin
      .from('invoices')
      .update(patch)
      .eq('id', id)
      .eq('status', invoice.status)
      .select()
      .maybeSingle();

    if (updateError) {
      return NextResponse.json(
        { error: friendlyError(updateError, 'Gagal memperbarui status invoice.', { context: 'Ubah status invoice' }) },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'Status invoice sudah diubah pihak lain. Muat ulang halaman lalu coba lagi.' },
        { status: 409 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_status_invoice',
      targetTable: 'invoices',
      targetId: id,
      detail: {
        nomor_surat: invoice.nomor_surat,
        nominal: invoice.nominal,
        status_sebelum: invoice.status,
        status_sesudah: statusBaru,
        tanggal_lunas_sebelum: invoice.tanggal_lunas || null,
        tanggal_lunas_sesudah: updated.tanggal_lunas || null,
      },
    });

    return NextResponse.json({ success: true, invoice: updated });
  } catch (err) {
    console.error('Ubah status invoice error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
