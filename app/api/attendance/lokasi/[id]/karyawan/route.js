import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireLokasiAdmin } from '@/lib/workLocationServer';
import { isIdValid } from '@/lib/workLocationValidation';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';

const MAKS_KARYAWAN = 2000;

// PUT /api/attendance/lokasi/[id]/karyawan   body: { employeeIds: string[] }
// Atur karyawan yang absennya dicek khusus ke lokasi ini (tabel
// employee_work_locations). Daftar yang dikirim = kondisi akhir.
//
// Dulu browser menghapus semua baris lokasi lalu insert ulang — kalau insert
// gagal, assignment hilang dan karyawan jatuh kembali ke "cek semua lokasi
// aktif". Sekarang server menghitung selisih: baris baru ditambah DULU, baru
// baris yang dicopot dihapus, jadi kegagalan di tengah tidak mengosongkan
// assignment. Karyawan yang ditambahkan harus ada dan berstatus Aktif.
export async function PUT(request, { params }) {
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
    const raw = body?.employeeIds;
    if (!Array.isArray(raw) || raw.length > MAKS_KARYAWAN || !raw.every(isIdValid)) {
      return NextResponse.json({ error: 'Daftar karyawan tidak valid.' }, { status: 400 });
    }
    const requested = new Set(raw);

    const { data: loc, error: locError } = await admin
      .from('work_locations')
      .select('id, nama')
      .eq('id', id)
      .maybeSingle();
    if (locError) {
      console.error('Baca lokasi kerja error:', locError);
      return NextResponse.json(
        { error: `Gagal memuat lokasi: ${friendlyError(locError, 'terjadi kesalahan pada server.', { context: 'Baca lokasi kerja' })}` },
        { status: 500 }
      );
    }
    if (!loc) return NextResponse.json({ error: 'Lokasi tidak ditemukan.' }, { status: 404 });

    const { data: currentRows, error: currentError } = await admin
      .from('employee_work_locations')
      .select('employee_id')
      .eq('work_location_id', loc.id);
    if (currentError) {
      console.error('Baca assignment lokasi error:', currentError);
      return NextResponse.json(
        { error: `Gagal memuat assignment: ${friendlyError(currentError, 'terjadi kesalahan pada server.', { context: 'Baca assignment lokasi' })}` },
        { status: 500 }
      );
    }
    const current = new Set((currentRows || []).map((r) => String(r.employee_id)));

    const toAdd = [...requested].filter((e) => !current.has(e));
    const toRemove = [...current].filter((e) => !requested.has(e));

    if (toAdd.length > 0) {
      const { data: found, error: empError } = await admin
        .from('employees')
        .select('id')
        .in('id', toAdd)
        .eq('status', 'Aktif');
      if (empError) {
        console.error('Validasi karyawan assignment error:', empError);
        return NextResponse.json(
          { error: `Gagal memeriksa karyawan: ${friendlyError(empError, 'terjadi kesalahan pada server.', { context: 'Validasi karyawan lokasi' })}` },
          { status: 500 }
        );
      }
      if ((found || []).length !== toAdd.length) {
        return NextResponse.json(
          { error: 'Sebagian karyawan tidak ditemukan atau tidak aktif. Muat ulang halaman lalu coba lagi.' },
          { status: 400 }
        );
      }

      const { error: insError } = await admin
        .from('employee_work_locations')
        .insert(toAdd.map((employee_id) => ({ employee_id, work_location_id: loc.id })));
      if (insError) {
        console.error('Tambah assignment lokasi error:', insError);
        return NextResponse.json(
          { error: `Gagal menyimpan assignment: ${friendlyError(insError, 'terjadi kesalahan pada server.', { context: 'Tambah assignment lokasi' })}` },
          { status: 500 }
        );
      }
    }

    if (toRemove.length > 0) {
      const { error: delError } = await admin
        .from('employee_work_locations')
        .delete()
        .eq('work_location_id', loc.id)
        .in('employee_id', toRemove);
      if (delError) {
        console.error('Hapus assignment lokasi error:', delError);
        return NextResponse.json(
          { error: `Gagal menyimpan assignment: ${friendlyError(delError, 'terjadi kesalahan pada server.', { context: 'Hapus assignment lokasi' })}` },
          { status: 500 }
        );
      }
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      await logActivity(admin, {
        userId: access.emp.id,
        aksi: 'atur_karyawan_lokasi_kerja',
        targetTable: 'employee_work_locations',
        targetId: loc.id,
        detail: {
          lokasi: loc.nama,
          ditambah: toAdd,
          dicopot: toRemove,
          total: requested.size,
        },
      });
    }

    return NextResponse.json({ success: true, total: requested.size });
  } catch (err) {
    console.error('PUT karyawan lokasi kerja error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
