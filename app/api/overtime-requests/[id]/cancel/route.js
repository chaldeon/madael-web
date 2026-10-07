import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { STATUS_LEMBUR_LABEL } from '@/lib/overtimeRules';

// POST /api/overtime-requests/[id]/cancel
// Karyawan membatalkan pengajuan lembur miliknya sendiri yang MASIH pending.
//
// Update-nya compare-and-swap (.eq('status', 'pending')): kalau admin
// menyetujui/menolak di saat yang sama, hanya salah satu yang menang, dan yang
// kalah mendapat 409. Satu-satunya perubahan yang bisa terjadi di sini adalah
// pending -> cancelled pada baris milik sendiri.
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['overtime']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const { data: updated, error: updateError } = await admin
      .from('overtime_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('employee_id', emp.id)
      .eq('status', 'pending')
      .select('id, tanggal, jam_mulai, durasi_menit')
      .maybeSingle();

    if (updateError) {
      console.error('Batalkan lembur error:', updateError);
      return NextResponse.json({ error: 'Gagal membatalkan pengajuan lembur. Coba lagi.' }, { status: 500 });
    }

    if (!updated) {
      const { data: existing } = await admin
        .from('overtime_requests')
        .select('status')
        .eq('id', id)
        .eq('employee_id', emp.id)
        .maybeSingle();

      if (!existing) {
        return NextResponse.json({ error: 'Pengajuan lembur tidak ditemukan.' }, { status: 404 });
      }
      const label = (STATUS_LEMBUR_LABEL[existing.status] || existing.status).toLowerCase();
      return NextResponse.json(
        { error: `Pengajuan ini sudah ${label}, jadi tidak bisa dibatalkan.`, status: existing.status },
        { status: 409 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'cancel_lembur',
      targetTable: 'overtime_requests',
      targetId: updated.id,
      detail: { employee_id: emp.id, tanggal: updated.tanggal, jam_mulai: updated.jam_mulai, durasi_menit: updated.durasi_menit },
    });

    return NextResponse.json({ success: true, status: 'cancelled' });
  } catch (err) {
    console.error('Batalkan lembur error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
