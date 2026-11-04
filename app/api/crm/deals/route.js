import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { requireCrmAccess, validateDealBaru, pastikanAda } from '@/lib/crmServer';

// POST /api/crm/deals
//   body: { company_id, stage?, nilai_potensial?, pic_internal?, catatan? }
//
// Tambah deal dari Pipeline Deal atau halaman detail klien. Dulu browser
// meng-insert ke crm_deals langsung tanpa validasi di server dan tanpa log.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireCrmAccess(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => null);
    const { values, error: validationError } = validateDealBaru(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const klien = await pastikanAda(admin, 'companies', values.company_id, 'Perusahaan tidak ditemukan.', 'Cek perusahaan deal');
    if (!klien.ok) return NextResponse.json({ error: klien.response.error }, { status: klien.response.status });
    if (values.pic_internal) {
      const pic = await pastikanAda(admin, 'employees', values.pic_internal, 'PIC internal tidak ditemukan.', 'Cek PIC deal');
      if (!pic.ok) return NextResponse.json({ error: pic.response.error }, { status: pic.response.status });
    }

    const { data: inserted, error: insertError } = await admin
      .from('crm_deals')
      .insert(values)
      .select('id')
      .single();
    if (insertError || !inserted) {
      return NextResponse.json(
        { error: `Gagal menyimpan deal: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Buat deal CRM' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'buat_deal_crm',
      targetTable: 'crm_deals',
      targetId: inserted.id,
      detail: {
        company_id: values.company_id,
        stage: values.stage,
        nilai_potensial: values.nilai_potensial,
        pic_internal: values.pic_internal,
      },
    });

    return NextResponse.json({ success: true, id: inserted.id });
  } catch (err) {
    console.error('Buat deal CRM error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
