import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { PASAL_DETAIL_COLUMNS, labelPeraturan, normalizeNomorPasal } from '@/lib/peraturanConfig';
import {
  UUID_RE, idAmanValid, gerbangTulisPeraturan, jsonError, bacaFormPasal, kolomPasalBerubah,
} from '@/lib/peraturanServer';

// Muat peraturan induk + pasal yang harus milik peraturan itu. Return
// { induk, pasal } atau { response } (400/404).
async function muatPasal(db, id, pasalId) {
  if (!UUID_RE.test(id)) return { response: jsonError('ID peraturan tidak valid.', 400) };
  if (!idAmanValid(pasalId)) return { response: jsonError('ID pasal tidak valid.', 400) };

  const { data: induk, error: indukError } = await db
    .from('peraturan')
    .select('id, jenis, nomor, tahun')
    .eq('id', id)
    .maybeSingle();
  if (indukError) throw indukError;
  if (!induk) return { response: jsonError('Peraturan tidak ditemukan.', 404) };

  const { data: pasal, error: pasalError } = await db
    .from('peraturan_pasal')
    .select(PASAL_DETAIL_COLUMNS)
    .eq('id', pasalId)
    .eq('peraturan_id', id)
    .maybeSingle();
  if (pasalError) {
    // 22P02 = id bukan format yang valid untuk kolom id
    if (pasalError.code === '22P02') return { response: jsonError('Pasal tidak ditemukan.', 404) };
    throw pasalError;
  }
  if (!pasal) return { response: jsonError('Pasal tidak ditemukan.', 404) };
  return { induk, pasal };
}

// PATCH /api/peraturan/[id]/pasal/[pasalId]
//   body: { form: { nomor_pasal, urutan, judul, isi, catatan } } -> { pasal }
// Hanya superadmin pemegang flag peraturan_ketenagakerjaan.
export async function PATCH(request, { params }) {
  try {
    const { id, pasalId } = await params;
    const admin = createAdminClient();
    const g = await gerbangTulisPeraturan(admin);
    if (g.response) return g.response;
    const { emp, db } = g;

    const body = await request.json().catch(() => ({}));
    const parsed = bacaFormPasal(body);
    if (parsed.error) return jsonError(parsed.error, 400);
    const { payload } = parsed;

    const loaded = await muatPasal(db, id, pasalId);
    if (loaded.response) return loaded.response;
    const { induk, pasal: before } = loaded;

    const { data, error } = await db
      .from('peraturan_pasal')
      .update(payload)
      .eq('id', pasalId)
      .eq('peraturan_id', id)
      .select(PASAL_DETAIL_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === '23505') {
        return jsonError(`Pasal ${normalizeNomorPasal(payload.nomor_pasal)} sudah ada di peraturan ini.`, 409);
      }
      if (error.code === '42501') return jsonError('Kamu tidak punya izin untuk mengubah pasal.', 403);
      return jsonError(
        `Gagal menyimpan perubahan pasal: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Ubah pasal' })}`,
        500
      );
    }
    if (!data) {
      // RLS menolak diam-diam (0 baris) atau pasal sudah dihapus.
      return jsonError('Perubahan tidak tersimpan: kamu tidak punya izin, atau pasal ini sudah dihapus.', 404);
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_pasal_peraturan',
      targetTable: 'peraturan_pasal',
      targetId: pasalId,
      detail: {
        peraturan: labelPeraturan(induk),
        peraturan_id: id,
        pasal: payload.nomor_pasal,
        kolom_berubah: kolomPasalBerubah(before, payload),
      },
    });

    return NextResponse.json({ pasal: data });
  } catch (err) {
    console.error('Ubah pasal peraturan:', err);
    return jsonError('Gagal menyimpan perubahan pasal.', 500);
  }
}

// DELETE /api/peraturan/[id]/pasal/[pasalId] -> { ok: true }
// Isi lengkap pasal dimuat di server dan disimpan ke Activity Log sebagai
// cadangan tambahan (selain riwayat revisi di database). Kalau isinya gagal
// dimuat, pasal tidak dihapus.
export async function DELETE(request, { params }) {
  try {
    const { id, pasalId } = await params;
    const admin = createAdminClient();
    const g = await gerbangTulisPeraturan(admin);
    if (g.response) return g.response;
    const { emp, db } = g;

    const loaded = await muatPasal(db, id, pasalId);
    if (loaded.response) return loaded.response;
    const { induk, pasal: snapshot } = loaded;

    // .select() supaya terlihat kalau RLS menolak (delete diam-diam 0 baris).
    const { data, error } = await db
      .from('peraturan_pasal')
      .delete()
      .eq('id', pasalId)
      .eq('peraturan_id', id)
      .select('id');
    if (error) {
      if (error.code === '42501') return jsonError('Kamu tidak punya izin untuk menghapus pasal.', 403);
      return jsonError(
        `Gagal menghapus pasal: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Hapus pasal' })}`,
        500
      );
    }
    if (!data || data.length === 0) {
      return jsonError('Pasal tidak terhapus: kamu tidak punya izin, atau pasalnya sudah tidak ada.', 404);
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'hapus_pasal_peraturan',
      targetTable: 'peraturan_pasal',
      targetId: pasalId,
      detail: {
        peraturan: labelPeraturan(induk),
        peraturan_id: id,
        pasal: snapshot.nomor_pasal,
        urutan: snapshot.urutan,
        judul: snapshot.judul,
        isi: snapshot.isi,
        catatan: snapshot.catatan,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Hapus pasal peraturan:', err);
    return jsonError('Gagal menghapus pasal.', 500);
  }
}
