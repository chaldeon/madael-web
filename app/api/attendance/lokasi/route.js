import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireLokasiAdmin } from '@/lib/workLocationServer';
import { validateLokasiInput } from '@/lib/workLocationValidation';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';

// POST /api/attendance/lokasi   body: { nama, latitude, longitude, radius_meter, aktif? }
// Tambah lokasi kerja (titik geofence absensi). Khusus superadmin.
//
// Dulu ditulis langsung dari browser ke tabel work_locations dengan validasi
// hanya di klien. Sekarang input divalidasi di server (rentang koordinat,
// radius, nama), akses dicek di server, dan perubahan masuk activity log.
// Tabel work_locations tidak lagi punya policy tulis untuk browser (lihat
// supabase/migrations/20261023000000_work_locations_server_only_writes.sql).
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireLokasiAdmin(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Data lokasi tidak valid.' }, { status: 400 });
    }
    const parsed = validateLokasiInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data: created, error } = await admin
      .from('work_locations')
      .insert([parsed.value])
      .select('id, nama, latitude, longitude, radius_meter, aktif')
      .single();
    if (error) {
      console.error('Tambah lokasi kerja error:', error);
      return NextResponse.json(
        { error: `Gagal menyimpan lokasi: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Tambah lokasi kerja' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: access.emp.id,
      aksi: 'tambah_lokasi_kerja',
      targetTable: 'work_locations',
      targetId: created.id,
      detail: { after: parsed.value },
    });

    return NextResponse.json({ success: true, location: created });
  } catch (err) {
    console.error('POST lokasi kerja error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
