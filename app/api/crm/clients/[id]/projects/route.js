import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { requireCrmAccess, validateProject, pastikanAda } from '@/lib/crmServer';

// POST /api/crm/clients/[id]/projects
//   body: { nama_project, jenis_layanan?, status?, nilai_kontrak?, tanggal_mulai?,
//           tanggal_selesai?, pic_madael?, catatan? }
//
// Tambah project klien. Dulu browser meng-insert ke client_projects langsung;
// nilai kontrak kini divalidasi dan pembuatannya tercatat di activity log.
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireCrmAccess(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => null);
    const { values, error: validationError } = validateProject(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const klien = await pastikanAda(admin, 'companies', id, 'Klien tidak ditemukan.', 'Cek klien project');
    if (!klien.ok) return NextResponse.json({ error: klien.response.error }, { status: klien.response.status === 400 ? 404 : klien.response.status });
    if (values.pic_madael) {
      const pic = await pastikanAda(admin, 'employees', values.pic_madael, 'PIC Madael tidak ditemukan.', 'Cek PIC project');
      if (!pic.ok) return NextResponse.json({ error: pic.response.error }, { status: pic.response.status });
    }

    const { data: inserted, error: insertError } = await admin
      .from('client_projects')
      .insert({ ...values, client_id: id })
      .select('id')
      .single();
    if (insertError || !inserted) {
      return NextResponse.json(
        { error: `Gagal menyimpan project: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Tambah project klien' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'tambah_project_klien',
      targetTable: 'client_projects',
      targetId: inserted.id,
      detail: {
        client_id: id,
        nama_project: values.nama_project,
        status: values.status,
        nilai_kontrak: values.nilai_kontrak,
      },
    });

    return NextResponse.json({ success: true, id: inserted.id });
  } catch (err) {
    console.error('Tambah project klien error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
