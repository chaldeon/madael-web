import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { labelPeraturan } from '@/lib/peraturanConfig';
import { UUID_RE, idAmanValid, gerbangTulisPeraturan, jsonError } from '@/lib/peraturanServer';

// DELETE /api/peraturan/[id]/relasi/[relasiId] -> { ok: true }
// [id] = peraturan yang sedang dibuka; relasinya boleh relasi keluar maupun
// masuk dari sisi peraturan itu (peraturan_id atau terkait_id = [id]).
// Hanya superadmin pemegang flag peraturan_ketenagakerjaan.
export async function DELETE(request, { params }) {
  try {
    const { id: idParam, relasiId } = await params;
    const id = String(idParam).toLowerCase(); // id dari DB selalu huruf kecil
    if (!UUID_RE.test(id)) return jsonError('ID peraturan tidak valid.', 400);
    if (!idAmanValid(relasiId)) return jsonError('ID relasi tidak valid.', 400);

    const admin = createAdminClient();
    const g = await gerbangTulisPeraturan(admin);
    if (g.response) return g.response;
    const { emp, db } = g;

    const { data: relasi, error: relasiError } = await db
      .from('peraturan_relasi')
      .select('id, peraturan_id, terkait_id, jenis_relasi, catatan')
      .eq('id', relasiId)
      .maybeSingle();
    if (relasiError) {
      // 22P02 = id bukan format yang valid untuk kolom id
      if (relasiError.code === '22P02') return jsonError('Relasi tidak ditemukan.', 404);
      throw relasiError;
    }
    if (!relasi || (relasi.peraturan_id !== id && relasi.terkait_id !== id)) {
      return jsonError('Relasi tidak ditemukan.', 404);
    }

    const { data: pasangan, error: pasanganError } = await db
      .from('peraturan')
      .select('id, jenis, nomor, tahun')
      .in('id', [relasi.peraturan_id, relasi.terkait_id]);
    if (pasanganError) throw pasanganError;
    const dari = (pasangan || []).find((p) => p.id === relasi.peraturan_id);
    const ke = (pasangan || []).find((p) => p.id === relasi.terkait_id);

    // .select() supaya terlihat kalau RLS menolak (delete diam-diam 0 baris).
    const { data, error } = await db.from('peraturan_relasi').delete().eq('id', relasiId).select('id');
    if (error) {
      if (error.code === '42501') return jsonError('Kamu tidak punya izin untuk menghapus relasi.', 403);
      return jsonError(
        `Gagal menghapus relasi: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Hapus relasi peraturan' })}`,
        500
      );
    }
    if (!data || data.length === 0) {
      return jsonError('Relasi tidak terhapus: kamu tidak punya izin, atau relasinya sudah tidak ada.', 404);
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'hapus_relasi_peraturan',
      targetTable: 'peraturan_relasi',
      targetId: relasiId,
      detail: {
        dari: labelPeraturan(dari),
        jenis_relasi: relasi.jenis_relasi,
        ke: labelPeraturan(ke),
        ...(relasi.catatan ? { catatan: relasi.catatan } : {}),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Hapus relasi peraturan:', err);
    return jsonError('Gagal menghapus relasi.', 500);
  }
}
