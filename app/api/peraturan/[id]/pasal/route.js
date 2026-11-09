import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { PASAL_DETAIL_COLUMNS, labelPeraturan, normalizeNomorPasal } from '@/lib/peraturanConfig';
import { UUID_RE, gerbangTulisPeraturan, jsonError, bacaFormPasal } from '@/lib/peraturanServer';

// POST /api/peraturan/[id]/pasal
//   body: { form: { nomor_pasal, urutan, judul, isi, catatan } }
//   -> 201 { pasal }  (baris lengkap, kolom PASAL_DETAIL_COLUMNS)
//
// Hanya superadmin pemegang flag peraturan_ketenagakerjaan. Penulisan memakai
// sesi pengguna (lihat lib/peraturanServer.js) supaya RLS dan trigger riwayat
// revisi pasal tetap mencatat pelakunya.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return jsonError('ID peraturan tidak valid.', 400);

    const admin = createAdminClient();
    const g = await gerbangTulisPeraturan(admin);
    if (g.response) return g.response;
    const { emp, db } = g;

    const body = await request.json().catch(() => ({}));
    const parsed = bacaFormPasal(body);
    if (parsed.error) return jsonError(parsed.error, 400);
    const { payload } = parsed;

    const { data: induk, error: indukError } = await db
      .from('peraturan')
      .select('id, jenis, nomor, tahun')
      .eq('id', id)
      .maybeSingle();
    if (indukError) throw indukError;
    if (!induk) return jsonError('Peraturan tidak ditemukan.', 404);

    const { data, error } = await db
      .from('peraturan_pasal')
      .insert([{ peraturan_id: id, ...payload }])
      .select(PASAL_DETAIL_COLUMNS)
      .single();
    if (error) {
      // Unique (peraturan_id, lower(nomor_pasal)) ditegakkan database.
      if (error.code === '23505') {
        return jsonError(`Pasal ${normalizeNomorPasal(payload.nomor_pasal)} sudah ada di peraturan ini.`, 409);
      }
      if (error.code === '42501') return jsonError('Kamu tidak punya izin untuk menambah pasal.', 403);
      return jsonError(
        `Gagal menyimpan pasal: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Tambah pasal' })}`,
        500
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'tambah_pasal_peraturan',
      targetTable: 'peraturan_pasal',
      targetId: data.id,
      detail: { peraturan: labelPeraturan(induk), peraturan_id: id, pasal: data.nomor_pasal },
    });

    return NextResponse.json({ pasal: data }, { status: 201 });
  } catch (err) {
    console.error('Tambah pasal peraturan:', err);
    return jsonError('Gagal menyimpan pasal.', 500);
  }
}
