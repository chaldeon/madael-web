import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { labelPeraturan } from '@/lib/peraturanConfig';
import {
  gerbangTulisPeraturan, jsonError, bacaFormPeraturan, bacaPdfBaru, pdfSudahDipakai,
} from '@/lib/peraturanServer';

// POST /api/peraturan
//   body: { form: { jenis, nomor, tahun, judul, ... }, pdf?: { fileId, nama, ukuran } }
//   -> 201 { peraturan: { id } }
//
// Hanya superadmin pemegang flag peraturan_ketenagakerjaan. Dulu form menulis
// langsung ke tabel dari browser; kini divalidasi ulang di server dan log
// ditulis di sini. Penulisan memakai sesi pengguna (lihat lib/peraturanServer.js)
// supaya RLS dan trigger pelaku/riwayat revisi tetap berlaku.
//
// PDF diunggah lebih dulu lewat /api/peraturan/pdf; kalau route ini gagal, klien
// menghapus berkas yang baru diunggah (sama seperti sebelumnya).
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const g = await gerbangTulisPeraturan(admin);
    if (g.response) return g.response;
    const { emp, db } = g;

    const body = await request.json().catch(() => ({}));
    const parsed = bacaFormPeraturan(body);
    if (parsed.error) return jsonError(parsed.error, 400);
    const pdf = bacaPdfBaru(body?.pdf);
    if (pdf.error) return jsonError(pdf.error, 400);

    if (pdf.value && (await pdfSudahDipakai(db, pdf.value.pdf_drive_id))) {
      return jsonError('Berkas PDF ini sudah dipakai peraturan lain.', 400);
    }

    const { payload } = parsed;
    const { data, error } = await db
      .from('peraturan')
      .insert([{ ...payload, ...(pdf.value || {}) }])
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') {
        return jsonError('Peraturan dengan jenis, nomor, dan tahun yang sama sudah ada.', 409);
      }
      if (error.code === '42501') return jsonError('Kamu tidak punya izin untuk menambah peraturan.', 403);
      return jsonError(
        `Gagal menyimpan peraturan: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Tambah peraturan' })}`,
        500
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'tambah_peraturan',
      targetTable: 'peraturan',
      targetId: data.id,
      detail: {
        peraturan: labelPeraturan(payload),
        judul: payload.judul,
        ...(pdf.value ? { pdf: pdf.value.pdf_nama } : {}),
      },
    });

    return NextResponse.json({ peraturan: { id: data.id } }, { status: 201 });
  } catch (err) {
    console.error('Tambah peraturan:', err);
    return jsonError('Gagal menyimpan peraturan.', 500);
  }
}
