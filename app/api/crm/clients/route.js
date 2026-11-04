import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { requireCrmAccess, validateKlien, pastikanAda } from '@/lib/crmServer';

// POST /api/crm/clients
//   body: { nama_perusahaan, tipe[], stage?, industri?, ukuran?, website?, alamat?,
//           kota?, pic_*?, assigned_to?, catatan?, fee_structure? }
//
// Tambah klien dari CRM — Client List. Dulu browser meng-insert ke tabel
// companies langsung (tanpa validasi di server, tanpa log). Hak: modul CRM.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireCrmAccess(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => null);
    const { values, error: validationError } = validateKlien(body, { withStage: true });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    if (values.assigned_to) {
      const cek = await pastikanAda(admin, 'employees', values.assigned_to, 'PIC internal tidak ditemukan.', 'Cek PIC klien');
      if (!cek.ok) return NextResponse.json({ error: cek.response.error }, { status: cek.response.status });
    }

    const { data: inserted, error: insertError } = await admin
      .from('companies')
      .insert(values)
      .select('id')
      .single();
    if (insertError || !inserted) {
      return NextResponse.json(
        { error: `Gagal menyimpan klien: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Buat klien CRM' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'buat_klien_crm',
      targetTable: 'companies',
      targetId: inserted.id,
      detail: {
        nama_perusahaan: values.nama_perusahaan,
        tipe: values.tipe,
        stage: values.stage,
        assigned_to: values.assigned_to,
      },
    });

    return NextResponse.json({ success: true, id: inserted.id });
  } catch (err) {
    console.error('Buat klien CRM error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
