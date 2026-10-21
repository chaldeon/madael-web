import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { STATUS_REIMBURSEMENT_LABEL } from '@/lib/reimbursement';

// POST /api/reimbursement/[id]/cancel
// Karyawan membatalkan klaim reimbursement miliknya sendiri yang MASIH pending.
//
// Update-nya compare-and-swap (.eq('status', 'pending')): kalau admin
// menyetujui/menolak di saat yang sama, hanya salah satu yang menang, dan yang
// kalah mendapat 409 (rute status admin juga update bersyarat). Satu-satunya
// perubahan yang bisa terjadi di sini adalah pending -> cancelled pada baris
// milik sendiri; kolom lain (jumlah, bukti, approved_by) tidak disentuh.
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['reimbursement']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const { data: updated, error: updateError } = await admin
      .from('reimbursement_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('employee_id', emp.id)
      .eq('status', 'pending')
      .select('id, kategori, jumlah')
      .maybeSingle();

    if (updateError) {
      // 22P02 = id bukan format yang valid untuk kolom id
      if (updateError.code === '22P02') {
        return NextResponse.json({ error: 'Klaim tidak ditemukan.' }, { status: 404 });
      }
      console.error('Batalkan reimbursement error:', updateError);
      return NextResponse.json({ error: 'Gagal membatalkan klaim reimbursement. Coba lagi.' }, { status: 500 });
    }

    if (!updated) {
      const { data: existing } = await admin
        .from('reimbursement_requests')
        .select('status')
        .eq('id', id)
        .eq('employee_id', emp.id)
        .maybeSingle();

      // Klaim milik orang lain diperlakukan sama dengan tidak ada (404),
      // supaya keberadaan klaim orang lain tidak bocor.
      if (!existing) {
        return NextResponse.json({ error: 'Klaim reimbursement tidak ditemukan.' }, { status: 404 });
      }
      const label = (STATUS_REIMBURSEMENT_LABEL[existing.status] || existing.status).toLowerCase();
      return NextResponse.json(
        { error: `Klaim ini sudah ${label}, jadi tidak bisa dibatalkan.`, status: existing.status },
        { status: 409 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'cancel_reimbursement',
      targetTable: 'reimbursement_requests',
      targetId: updated.id,
      detail: { employee_id: emp.id, jumlah: updated.jumlah, kategori: updated.kategori },
    });

    return NextResponse.json({ success: true, status: 'cancelled' });
  } catch (err) {
    console.error('Batalkan reimbursement error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
