import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { DETAIL_COLUMNS, STATUS_OPTIONS, labelPeraturan } from '@/lib/peraturanConfig';
import {
  UUID_RE, gerbangTulisPeraturan, jsonError, bacaFormPeraturan, bacaPdfBaru, pdfSudahDipakai,
  cariIdDuplikat, kolomPeraturanBerubah,
} from '@/lib/peraturanServer';

const ACTIONS = ['edit', 'ubah_status'];
// Asal perubahan status yang dikenal (untuk detail audit); nilai lain diabaikan.
const VIA_VALID = ['relasi_mencabut', 'relasi_mengubah'];

// PATCH /api/peraturan/[id]   body: { action, ... }
//   'edit'        : { form, pdf?, hapus_pdf? }
//                   -> { ok, id, pdf_lama_id }  (pdf_lama_id = berkas Drive yang
//                      tidak dirujuk lagi karena diganti/dihapus; klien
//                      membersihkannya lewat DELETE /api/peraturan/pdf)
//   'ubah_status' : { status_baru, status_sebelumnya }
//                   Dikunci ke status yang terakhir terlihat klien supaya tidak
//                   menimpa perubahan orang lain (dipakai sinkron status relasi).
//
// Hanya superadmin pemegang flag peraturan_ketenagakerjaan.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return jsonError('ID peraturan tidak valid.', 400);

    const admin = createAdminClient();
    const g = await gerbangTulisPeraturan(admin);
    if (g.response) return g.response;
    const { emp, db } = g;

    const body = await request.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : '';
    if (!ACTIONS.includes(action)) return jsonError('Aksi tidak valid.', 400);

    if (action === 'ubah_status') {
      const statusBaru = body.status_baru;
      const statusLama = body.status_sebelumnya;
      if (!STATUS_OPTIONS.includes(statusBaru) || !STATUS_OPTIONS.includes(statusLama)) {
        return jsonError('Status tidak valid.', 400);
      }

      const { data, error } = await db
        .from('peraturan')
        .update({ status: statusBaru })
        .eq('id', id)
        .eq('status', statusLama)
        .select('id, jenis, nomor, tahun, judul')
        .maybeSingle();
      if (error) {
        return jsonError(
          `Gagal mengubah status peraturan: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Sinkron status peraturan' })}`,
          500
        );
      }
      if (!data) {
        return jsonError(
          'Status tidak berubah: statusnya sudah diubah orang lain, kamu tidak punya izin, atau peraturannya sudah dihapus.',
          409
        );
      }

      await logActivity(admin, {
        userId: emp.id,
        aksi: 'ubah_peraturan',
        targetTable: 'peraturan',
        targetId: id,
        detail: {
          peraturan: labelPeraturan(data),
          judul: data.judul,
          kolom_berubah: ['status'],
          status_dari: statusLama,
          status_ke: statusBaru,
          ...(VIA_VALID.includes(body.via) ? { via: body.via } : {}),
        },
      });
      return NextResponse.json({ ok: true, id });
    }

    // action === 'edit'
    const parsed = bacaFormPeraturan(body);
    if (parsed.error) return jsonError(parsed.error, 400);
    const pdf = bacaPdfBaru(body?.pdf);
    if (pdf.error) return jsonError(pdf.error, 400);

    const { data: before, error: beforeError } = await db
      .from('peraturan')
      .select(DETAIL_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (beforeError) throw beforeError;
    if (!before) return jsonError('Peraturan tidak ditemukan.', 404);

    if (pdf.value && (await pdfSudahDipakai(db, pdf.value.pdf_drive_id, id))) {
      return jsonError('Berkas PDF ini sudah dipakai peraturan lain.', 400);
    }

    const { payload } = parsed;
    let pdfColumns = {};
    if (pdf.value) {
      pdfColumns = pdf.value;
    } else if (body?.hapus_pdf === true && before.pdf_drive_id) {
      pdfColumns = { pdf_drive_id: null, pdf_nama: null, pdf_ukuran: null };
    }

    const { data, error } = await db
      .from('peraturan')
      .update({ ...payload, ...pdfColumns })
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) {
      if (error.code === '23505') {
        const duplicateId = await cariIdDuplikat(db, payload, id);
        return jsonError('Peraturan dengan jenis, nomor, dan tahun yang sama sudah ada.', 409, { duplicate_id: duplicateId });
      }
      if (error.code === '42501') return jsonError('Kamu tidak punya izin untuk mengubah peraturan.', 403);
      return jsonError(
        `Gagal menyimpan perubahan peraturan: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Ubah peraturan' })}`,
        500
      );
    }
    if (!data) {
      // RLS menolak diam-diam (0 baris) atau baris terhapus di antara dua query.
      return jsonError('Perubahan tidak tersimpan: kamu tidak punya izin, atau peraturan ini sudah dihapus.', 404);
    }

    const changed = kolomPeraturanBerubah(before, payload);
    if ('pdf_drive_id' in pdfColumns) changed.push('pdf_drive_id');
    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_peraturan',
      targetTable: 'peraturan',
      targetId: id,
      detail: { peraturan: labelPeraturan(payload), judul: payload.judul, kolom_berubah: changed },
    });

    // Berkas lama baru dilepas kalau memang diganti/dihapus (bukan berkas yang sama).
    const pdfLamaId =
      'pdf_drive_id' in pdfColumns && before.pdf_drive_id && before.pdf_drive_id !== pdfColumns.pdf_drive_id
        ? before.pdf_drive_id
        : null;
    return NextResponse.json({ ok: true, id, pdf_lama_id: pdfLamaId });
  } catch (err) {
    console.error('Ubah peraturan:', err);
    return jsonError('Gagal menyimpan perubahan peraturan.', 500);
  }
}

// DELETE /api/peraturan/[id] -> { ok: true, pdf_drive_id }
// Relasi dan pasal ikut terhapus (cascade FK); trigger BEFORE DELETE menyalin
// semuanya ke riwayat revisi sebelum baris hilang, jadi bisa dipulihkan dari
// halaman "Peraturan terhapus". Berkas PDF di Drive dibersihkan klien lewat
// DELETE /api/peraturan/pdf (pdf_drive_id dikembalikan di sini).
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return jsonError('ID peraturan tidak valid.', 400);

    const admin = createAdminClient();
    const g = await gerbangTulisPeraturan(admin);
    if (g.response) return g.response;
    const { emp, db } = g;

    const { data: before, error: beforeError } = await db
      .from('peraturan')
      .select('id, jenis, nomor, tahun, judul, pdf_drive_id, pdf_nama')
      .eq('id', id)
      .maybeSingle();
    if (beforeError) throw beforeError;
    if (!before) return jsonError('Peraturan tidak ditemukan.', 404);

    // .select() supaya terlihat kalau RLS menolak (delete diam-diam 0 baris).
    const { data, error } = await db.from('peraturan').delete().eq('id', id).select('id');
    if (error) {
      if (error.code === '42501') return jsonError('Kamu tidak punya izin untuk menghapus peraturan.', 403);
      return jsonError(
        `Gagal menghapus peraturan: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Hapus peraturan' })}`,
        500
      );
    }
    if (!data || data.length === 0) {
      return jsonError('Peraturan tidak terhapus: kamu tidak punya izin, atau datanya sudah tidak ada.', 404);
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'hapus_peraturan',
      targetTable: 'peraturan',
      targetId: id,
      detail: {
        peraturan: labelPeraturan(before),
        judul: before.judul,
        ...(before.pdf_nama ? { pdf: before.pdf_nama } : {}),
      },
    });

    return NextResponse.json({ ok: true, pdf_drive_id: before.pdf_drive_id || null });
  } catch (err) {
    console.error('Hapus peraturan:', err);
    return jsonError('Gagal menghapus peraturan.', 500);
  }
}
