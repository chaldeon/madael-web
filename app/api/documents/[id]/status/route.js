import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { muatDokumenUntukKelola } from '@/lib/documentAccessServer';
import {
  DOKUMEN_STATUS_VALID,
  cekTransisiDokumen,
  validateStatusBody,
} from '@/lib/documentServer';

// PATCH /api/documents/[id]/status
//   body: { status: 'Draft' | 'Final' | 'Terkirim' | 'Ditandatangani' }
//
// Ubah status dokumen dari halaman detail dokumen. Dulu browser meng-update
// tabel documents langsung: tanpa log dan tanpa pemeriksaan hak di server.
//
// Hak: sama dengan tombol di halaman (superadmin, pembuat dokumen, atau
// pemegang document_manage). Status 'Ditandatangani' hanya bisa diubah lagi
// oleh superadmin. Update bersyarat pada status lama (409 kalau sudah
// diubah pihak lain). Setiap perubahan tercatat (sebelum → sesudah).
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const gate = await muatDokumenUntukKelola(admin, id, 'id, nomor_surat, judul, status, created_by');
    if (gate.error) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
    const { emp, doc } = gate;

    const body = await request.json().catch(() => null);
    const { status: statusBaru, error: validationError } = validateStatusBody(body, DOKUMEN_STATUS_VALID, 'dokumen');
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const transisiError = cekTransisiDokumen(doc.status, statusBaru, { isSuperadmin: !!emp.is_superadmin });
    if (transisiError) {
      return NextResponse.json({ error: transisiError }, { status: 400 });
    }

    const { data: updated, error: updateError } = await admin
      .from('documents')
      .update({ status: statusBaru })
      .eq('id', id)
      .eq('status', doc.status)
      .select('id, status')
      .maybeSingle();

    if (updateError) {
      return NextResponse.json(
        { error: friendlyError(updateError, 'Gagal update status, coba lagi.', { context: 'Ubah status dokumen' }) },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'Status dokumen sudah diubah pihak lain. Muat ulang halaman lalu coba lagi.' },
        { status: 409 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_status_dokumen',
      targetTable: 'documents',
      targetId: id,
      detail: {
        nomor_surat: doc.nomor_surat,
        judul: doc.judul,
        status_sebelum: doc.status,
        status_sesudah: statusBaru,
      },
    });

    return NextResponse.json({ success: true, status: updated.status });
  } catch (err) {
    console.error('Ubah status dokumen error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
