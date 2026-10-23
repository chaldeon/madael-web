import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireLokasiAdmin } from '@/lib/workLocationServer';
import { validateLokasiInput, isIdValid } from '@/lib/workLocationValidation';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';

const KOLOM = 'id, nama, latitude, longitude, radius_meter, aktif';

// PATCH  /api/attendance/lokasi/[id]   body: sebagian dari { nama, latitude, longitude, radius_meter, aktif }
// DELETE /api/attendance/lokasi/[id]
// Ubah / hapus lokasi kerja (geofence absensi). Khusus superadmin; input
// divalidasi di server dan tiap perubahan dicatat di activity log.
// Data absensi lama tidak berubah — lokasi yang dihapus/dinonaktifkan hanya
// berhenti dipakai untuk cek radius ke depannya.

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    if (!isIdValid(id)) {
      return NextResponse.json({ error: 'ID lokasi tidak valid.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const access = await requireLokasiAdmin(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Data lokasi tidak valid.' }, { status: 400 });
    }
    const parsed = validateLokasiInput(body, { partial: true });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data: before, error: readError } = await admin
      .from('work_locations')
      .select(KOLOM)
      .eq('id', id)
      .maybeSingle();
    if (readError) {
      console.error('Baca lokasi kerja error:', readError);
      return NextResponse.json(
        { error: `Gagal memuat lokasi: ${friendlyError(readError, 'terjadi kesalahan pada server.', { context: 'Baca lokasi kerja' })}` },
        { status: 500 }
      );
    }
    if (!before) return NextResponse.json({ error: 'Lokasi tidak ditemukan.' }, { status: 404 });

    const { data: after, error: updateError } = await admin
      .from('work_locations')
      .update(parsed.value)
      .eq('id', id)
      .select(KOLOM)
      .maybeSingle();
    if (updateError) {
      console.error('Ubah lokasi kerja error:', updateError);
      return NextResponse.json(
        { error: `Gagal menyimpan lokasi: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Ubah lokasi kerja' })}` },
        { status: 500 }
      );
    }
    if (!after) {
      // Dihapus superadmin lain di sela baca dan ubah.
      return NextResponse.json({ error: 'Lokasi tidak ditemukan.' }, { status: 404 });
    }

    // Log hanya field yang benar-benar berubah.
    const berubah = Object.keys(parsed.value).filter((k) => before[k] !== after[k]);
    if (berubah.length > 0) {
      await logActivity(admin, {
        userId: access.emp.id,
        aksi: 'ubah_lokasi_kerja',
        targetTable: 'work_locations',
        targetId: after.id,
        detail: {
          nama: after.nama,
          before: Object.fromEntries(berubah.map((k) => [k, before[k]])),
          after: Object.fromEntries(berubah.map((k) => [k, after[k]])),
        },
      });
    }

    return NextResponse.json({ success: true, location: after });
  } catch (err) {
    console.error('PATCH lokasi kerja error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    if (!isIdValid(id)) {
      return NextResponse.json({ error: 'ID lokasi tidak valid.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const access = await requireLokasiAdmin(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { data: deleted, error } = await admin
      .from('work_locations')
      .delete()
      .eq('id', id)
      .select(KOLOM)
      .maybeSingle();
    if (error) {
      console.error('Hapus lokasi kerja error:', error);
      return NextResponse.json(
        { error: `Gagal menghapus lokasi: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Hapus lokasi kerja' })}` },
        { status: 500 }
      );
    }
    if (!deleted) return NextResponse.json({ error: 'Lokasi tidak ditemukan.' }, { status: 404 });

    await logActivity(admin, {
      userId: access.emp.id,
      aksi: 'hapus_lokasi_kerja',
      targetTable: 'work_locations',
      targetId: deleted.id,
      detail: { before: deleted },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE lokasi kerja error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
