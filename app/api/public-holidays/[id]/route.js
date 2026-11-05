import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { jenisLiburValid, MAKS_NAMA_LIBUR } from '@/lib/publicHolidays';

const ID_RE = /^[0-9a-fA-F-]{36}$/;

// Muat satu baris libur; return { row } atau { error, status }.
async function muatBaris(admin, id) {
  if (!ID_RE.test(id)) return { error: 'ID hari libur tidak valid.', status: 400 };
  const { data, error } = await admin
    .from('public_holidays')
    .select('id, tanggal, nama, jenis')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('Muat hari libur error:', error);
    return { error: `Gagal memuat hari libur: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Muat hari libur' })}`, status: 500 };
  }
  if (!data) return { error: 'Hari libur tidak ditemukan (mungkin sudah dihapus).', status: 404 };
  return { row: data };
}

// PATCH /api/public-holidays/[id]  body: { nama?, jenis? }
// Ubah nama atau jenis. Tanggal tidak bisa diubah (hapus lalu tambah baru) supaya
// tidak ada dua operasi tersembunyi dalam satu aksi. Khusus superadmin.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['hari_libur']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 });
    }

    const patch = {};
    if (body.nama !== undefined) {
      const nama = typeof body.nama === 'string' ? body.nama.trim() : '';
      if (!nama) return NextResponse.json({ error: 'Nama libur wajib diisi.' }, { status: 400 });
      if (nama.length > MAKS_NAMA_LIBUR) {
        return NextResponse.json({ error: `Nama libur maksimal ${MAKS_NAMA_LIBUR} karakter.` }, { status: 400 });
      }
      patch.nama = nama;
    }
    if (body.jenis !== undefined) {
      if (!jenisLiburValid(body.jenis)) {
        return NextResponse.json({ error: 'Jenis libur harus nasional atau cuti_bersama.' }, { status: 400 });
      }
      patch.jenis = body.jenis;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Tidak ada perubahan yang dikirim.' }, { status: 400 });
    }

    const before = await muatBaris(admin, id);
    if (before.error) return NextResponse.json({ error: before.error }, { status: before.status });

    const { data: saved, error } = await admin
      .from('public_holidays')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, tanggal, nama, jenis')
      .maybeSingle();
    if (error) {
      console.error('Ubah hari libur error:', error);
      return NextResponse.json(
        { error: `Gagal menyimpan hari libur: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Ubah hari libur' })}` },
        { status: 500 }
      );
    }
    if (!saved) return NextResponse.json({ error: 'Hari libur tidak ditemukan (mungkin sudah dihapus).' }, { status: 404 });

    await logActivity(admin, {
      userId: access.emp.id,
      aksi: 'ubah_hari_libur',
      targetTable: 'public_holidays',
      targetId: id,
      detail: { tanggal: saved.tanggal, before: { nama: before.row.nama, jenis: before.row.jenis }, after: { nama: saved.nama, jenis: saved.jenis } },
    });

    return NextResponse.json({ success: true, row: saved });
  } catch (err) {
    console.error('Ubah hari libur error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

// DELETE /api/public-holidays/[id]
// Hapus satu tanggal libur. Mudah dibatalkan (tambah lagi tanggalnya) dan
// tercatat di Activity Log. Pengajuan cuti yang sudah disetujui tidak berubah
// (jumlah_hari sudah tersimpan); yang masih menunggu dihitung ulang tanpa libur
// itu. Khusus superadmin.
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['hari_libur']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const before = await muatBaris(admin, id);
    if (before.error) return NextResponse.json({ error: before.error }, { status: before.status });

    const { error } = await admin.from('public_holidays').delete().eq('id', id);
    if (error) {
      console.error('Hapus hari libur error:', error);
      return NextResponse.json(
        { error: `Gagal menghapus hari libur: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Hapus hari libur' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: access.emp.id,
      aksi: 'hapus_hari_libur',
      targetTable: 'public_holidays',
      targetId: id,
      detail: { tanggal: before.row.tanggal, nama: before.row.nama, jenis: before.row.jenis },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Hapus hari libur error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
