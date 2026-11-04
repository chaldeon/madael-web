import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { requireCrmAccess, validateStageBody } from '@/lib/crmServer';

// PATCH /api/crm/deals/[id]
//   body: { stage }
//
// Pindah stage deal (drag & drop kanban atau dropdown di detail klien). Dulu
// browser meng-update crm_deals langsung tanpa jejak. Semua perpindahan stage
// tetap diizinkan seperti sebelumnya; stage divalidasi dan tiap perpindahan
// tercatat sebelum → sesudah.
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

    const { data: deal, error: loadError } = await admin
      .from('crm_deals')
      .select('id, company_id, stage, nilai_potensial')
      .eq('id', id)
      .maybeSingle();
    if (loadError && loadError.code !== '22P02') {
      return NextResponse.json(
        { error: `Gagal memuat deal: ${friendlyError(loadError, 'terjadi kesalahan pada server.', { context: 'Muat deal untuk ganti stage' })}` },
        { status: 500 }
      );
    }
    if (loadError || !deal) {
      return NextResponse.json({ error: 'Deal tidak ditemukan.' }, { status: 404 });
    }

    if (deal.stage === stage) {
      return NextResponse.json({ success: true, unchanged: true });
    }

    const { error: updateError } = await admin
      .from('crm_deals')
      .update({ stage, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updateError) {
      return NextResponse.json(
        { error: `Gagal update stage: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Ganti stage deal' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_stage_deal',
      targetTable: 'crm_deals',
      targetId: id,
      detail: {
        company_id: deal.company_id,
        nilai_potensial: deal.nilai_potensial,
        stage_sebelum: deal.stage,
        stage_sesudah: stage,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Ganti stage deal error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
