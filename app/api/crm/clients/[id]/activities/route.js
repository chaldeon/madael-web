import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { requireCrmAccess, validateAktivitas, pastikanAda } from '@/lib/crmServer';

// POST /api/crm/clients/[id]/activities
//   body: { tipe, judul?, deskripsi?, tanggal, follow_up_date? }
//
// Tambah aktivitas klien. Dulu browser meng-insert ke client_activities
// dengan employee_id yang ia cari sendiri; sekarang employee_id SELALU dari
// sesi login (aktivitas tidak bisa dicatat atas nama orang lain).
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
    const { values, error: validationError } = validateAktivitas(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const cek = await pastikanAda(admin, 'companies', id, 'Klien tidak ditemukan.', 'Cek klien aktivitas');
    if (!cek.ok) return NextResponse.json({ error: cek.response.error }, { status: cek.response.status === 400 ? 404 : cek.response.status });

    const { data: inserted, error: insertError } = await admin
      .from('client_activities')
      .insert({ ...values, client_id: id, employee_id: emp.id })
      .select('id')
      .single();
    if (insertError || !inserted) {
      return NextResponse.json(
        { error: `Gagal menyimpan aktivitas: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Tambah aktivitas klien' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'tambah_aktivitas_klien',
      targetTable: 'client_activities',
      targetId: inserted.id,
      detail: { client_id: id, tipe: values.tipe, judul: values.judul, tanggal: values.tanggal },
    });

    return NextResponse.json({ success: true, id: inserted.id });
  } catch (err) {
    console.error('Tambah aktivitas klien error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
