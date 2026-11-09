import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { LIMITS, RELASI_LABEL, labelPeraturan } from '@/lib/peraturanConfig';
import { UUID_RE, gerbangTulisPeraturan, jsonError } from '@/lib/peraturanServer';

// POST /api/peraturan/[id]/relasi
//   body: { terkait_id, jenis_relasi, catatan? }  -> 201 { relasi: { id } }
// Relasi selalu ditambah dari sisi pelaku: peraturan [id] <jenis_relasi>
// peraturan terkait_id. Hanya superadmin pemegang flag peraturan_ketenagakerjaan.
//
// Status peraturan target TIDAK diubah di sini: sinkron status tetap tindakan
// terpisah yang dikonfirmasi pengguna (PATCH /api/peraturan/[id] 'ubah_status').
export async function POST(request, { params }) {
  try {
    const { id: idParam } = await params;
    const id = String(idParam).toLowerCase(); // id dari DB selalu huruf kecil
    if (!UUID_RE.test(id)) return jsonError('ID peraturan tidak valid.', 400);

    const admin = createAdminClient();
    const g = await gerbangTulisPeraturan(admin);
    if (g.response) return g.response;
    const { emp, db } = g;

    const body = await request.json().catch(() => ({}));
    const terkaitId = typeof body?.terkait_id === 'string' ? body.terkait_id.toLowerCase() : '';
    if (!UUID_RE.test(terkaitId)) return jsonError('Peraturan target tidak valid.', 400);
    if (terkaitId === id) return jsonError('Peraturan tidak bisa berelasi dengan dirinya sendiri.', 400);

    const jenisRelasi = typeof body?.jenis_relasi === 'string' ? body.jenis_relasi : '';
    if (!Object.hasOwn(RELASI_LABEL, jenisRelasi)) return jsonError('Jenis relasi tidak valid.', 400);

    if (body?.catatan !== undefined && body?.catatan !== null && typeof body.catatan !== 'string') {
      return jsonError('Catatan tidak valid.', 400);
    }
    const catatan = (body?.catatan || '').trim();
    if (catatan.length > LIMITS.catatanRelasi) {
      return jsonError(`Catatan maksimal ${LIMITS.catatanRelasi} karakter.`, 400);
    }

    const { data: pasangan, error: pasanganError } = await db
      .from('peraturan')
      .select('id, jenis, nomor, tahun')
      .in('id', [id, terkaitId]);
    if (pasanganError) throw pasanganError;
    const ini = (pasangan || []).find((p) => p.id === id);
    const target = (pasangan || []).find((p) => p.id === terkaitId);
    if (!ini || !target) return jsonError('Peraturan tidak ditemukan.', 404);

    const { data, error } = await db
      .from('peraturan_relasi')
      .insert([{
        peraturan_id: id,
        terkait_id: terkaitId,
        jenis_relasi: jenisRelasi,
        catatan: catatan || null,
      }])
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return jsonError('Relasi ini sudah ada.', 409);
      if (error.code === '23514' && /bukan_diri/.test(error.message || '')) {
        return jsonError('Peraturan tidak bisa berelasi dengan dirinya sendiri.', 400);
      }
      if (error.code === '42501') return jsonError('Kamu tidak punya izin untuk menambah relasi.', 403);
      return jsonError(
        `Gagal menyimpan relasi: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Tambah relasi peraturan' })}`,
        500
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'tambah_relasi_peraturan',
      targetTable: 'peraturan_relasi',
      targetId: data.id,
      detail: {
        dari: labelPeraturan(ini),
        jenis_relasi: jenisRelasi,
        ke: labelPeraturan(target),
        ...(catatan ? { catatan } : {}),
      },
    });

    return NextResponse.json({ relasi: { id: data.id } }, { status: 201 });
  } catch (err) {
    console.error('Tambah relasi peraturan:', err);
    return jsonError('Gagal menyimpan relasi.', 500);
  }
}
