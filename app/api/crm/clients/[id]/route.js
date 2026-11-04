import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { requireCrmAccess, validateKlien, pastikanAda } from '@/lib/crmServer';

// PATCH /api/crm/clients/[id]
//   body: sama dengan tambah klien, tanpa stage (stage lewat /stage)
//
// Simpan hasil edit info klien dari halaman detail klien. Dulu browser
// meng-update tabel companies langsung. Hak: modul CRM. Log mencatat nama
// field yang berubah beserta nilai sebelum → sesudah (nilai panjang
// dipotong).
const FIELD_DIPANTAU = [
  'nama_perusahaan', 'industri', 'ukuran', 'website', 'alamat', 'kota',
  'pic_nama', 'pic_jabatan', 'pic_email', 'pic_telepon', 'assigned_to',
  'catatan', 'tipe', 'fee_structure',
];
const MAKS_NILAI_LOG = 200;

function ringkas(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value.length > MAKS_NILAI_LOG ? `${value.slice(0, MAKS_NILAI_LOG)}…` : value;
  return value;
}

function samaNilai(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

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
    const { values, error: validationError } = validateKlien(body, { withStage: false });
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { data: sebelum, error: loadError } = await admin
      .from('companies')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (loadError && loadError.code !== '22P02') {
      return NextResponse.json(
        { error: `Gagal memuat klien: ${friendlyError(loadError, 'terjadi kesalahan pada server.', { context: 'Muat klien CRM' })}` },
        { status: 500 }
      );
    }
    if (loadError || !sebelum) {
      return NextResponse.json({ error: 'Klien tidak ditemukan.' }, { status: 404 });
    }

    if (values.assigned_to && values.assigned_to !== sebelum.assigned_to) {
      const cek = await pastikanAda(admin, 'employees', values.assigned_to, 'PIC internal tidak ditemukan.', 'Cek PIC klien');
      if (!cek.ok) return NextResponse.json({ error: cek.response.error }, { status: cek.response.status });
    }

    const { error: updateError } = await admin.from('companies').update(values).eq('id', id);
    if (updateError) {
      return NextResponse.json(
        { error: `Gagal menyimpan: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Edit klien CRM' })}` },
        { status: 500 }
      );
    }

    const berubah = {};
    for (const f of FIELD_DIPANTAU) {
      if (!samaNilai(sebelum[f], values[f])) {
        berubah[f] = { sebelum: ringkas(sebelum[f]), sesudah: ringkas(values[f]) };
      }
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_klien_crm',
      targetTable: 'companies',
      targetId: id,
      detail: { nama_perusahaan: values.nama_perusahaan, field_berubah: berubah },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Edit klien CRM error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
