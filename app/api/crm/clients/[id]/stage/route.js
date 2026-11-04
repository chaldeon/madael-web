import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { requireCrmAccess, validateStageBody } from '@/lib/crmServer';

// PATCH /api/crm/clients/[id]/stage
//   body: { stage }
//
// Ganti stage klien (Prospek → … → Closed Won/Lost). Dulu browser meng-update
// companies langsung tanpa jejak. Semua perpindahan antar stage tetap
// diizinkan seperti sebelumnya (pipeline BD sering maju-mundur); yang
// berubah: stage divalidasi dan setiap perpindahan tercatat sebelum → sesudah.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireCrmAccess(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => null);
    const { stage, error: validationError } = validateStageBody(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { data: klien, error: loadError } = await admin
      .from('companies')
      .select('id, nama_perusahaan, stage')
      .eq('id', id)
      .maybeSingle();
    if (loadError && loadError.code !== '22P02') {
      return NextResponse.json(
        { error: `Gagal memuat klien: ${friendlyError(loadError, 'terjadi kesalahan pada server.', { context: 'Muat klien untuk ganti stage' })}` },
        { status: 500 }
      );
    }
    if (loadError || !klien) {
      return NextResponse.json({ error: 'Klien tidak ditemukan.' }, { status: 404 });
    }

    // Stage sama: tidak ada yang diubah dan tidak perlu dicatat (bukan error,
    // supaya klik "Simpan" tanpa perubahan tetap menutup modal seperti dulu).
    if (klien.stage === stage) {
      return NextResponse.json({ success: true, unchanged: true });
    }

    const { error: updateError } = await admin.from('companies').update({ stage }).eq('id', id);
    if (updateError) {
      return NextResponse.json(
        { error: `Gagal ganti stage: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Ganti stage klien' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_stage_klien',
      targetTable: 'companies',
      targetId: id,
      detail: { nama_perusahaan: klien.nama_perusahaan, stage_sebelum: klien.stage, stage_sesudah: stage },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Ganti stage klien error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
