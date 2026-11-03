import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { COUNTER_AKTIF, validateKoreksiCounter } from '@/lib/documentNumberServer';

// PATCH /api/documents/counters/[id]
//   body: { last_number, expected_last_number, konfirmasi_turun? }
//
// Koreksi counter nomor surat dari halaman Nomor Surat. Dulu browser meng-update
// document_counters langsung: tanpa aturan server dan tanpa activity log.
//
// Aturan di sini:
// - hak modul nomor_surat dicek (sama dengan halaman Nomor Surat);
// - hanya counter aktif (GLOBAL, INV) yang boleh diubah — arsip tidak;
// - update bersyarat pada expected_last_number: kalau sementara itu ada nomor
//   baru yang diambil, koreksi ditolak (409) supaya nomor itu tidak tertimpa;
// - menurunkan counter butuh konfirmasi eksplisit (risiko nomor ganda);
// - setiap koreksi tercatat di activity log (sebelum → sesudah).
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['nomor_surat']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => null);
    const { values, error: validationError } = validateKoreksiCounter(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { data: counter, error: counterError } = await admin
      .from('document_counters')
      .select('id, kode, nama, last_number')
      .eq('id', id)
      .maybeSingle();
    if (counterError && counterError.code !== '22P02') {
      return NextResponse.json(
        { error: `Gagal memuat counter: ${friendlyError(counterError, 'terjadi kesalahan pada server.', { context: 'Muat counter nomor surat' })}` },
        { status: 500 }
      );
    }
    if (counterError || !counter) {
      return NextResponse.json({ error: 'Counter tidak ditemukan.' }, { status: 404 });
    }
    if (!COUNTER_AKTIF.includes(counter.kode)) {
      return NextResponse.json({ error: 'Counter arsip tidak bisa diubah.' }, { status: 400 });
    }
    if (Number(counter.last_number) !== values.expected_last_number) {
      return NextResponse.json(
        { error: 'Nomor counter sudah berubah (ada dokumen baru). Muat ulang halaman lalu coba lagi.' },
        { status: 409 }
      );
    }
    if (values.last_number === values.expected_last_number) {
      return NextResponse.json({ error: 'Tidak ada perubahan nomor.' }, { status: 400 });
    }
    if (values.last_number < values.expected_last_number && !values.konfirmasi_turun) {
      return NextResponse.json(
        { error: 'Menurunkan nomor bisa menghasilkan nomor ganda. Centang konfirmasi untuk melanjutkan.' },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await admin
      .from('document_counters')
      .update({ last_number: values.last_number })
      .eq('id', counter.id)
      .eq('last_number', values.expected_last_number)
      .select('id');
    if (updateError) {
      return NextResponse.json(
        { error: `Gagal update nomor: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Koreksi counter nomor surat' })}` },
        { status: 500 }
      );
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { error: 'Nomor counter sudah berubah (ada dokumen baru). Muat ulang halaman lalu coba lagi.' },
        { status: 409 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'koreksi_counter_nomor',
      targetTable: 'document_counters',
      targetId: counter.id,
      detail: {
        kode: counter.kode,
        sebelum: { last_number: values.expected_last_number },
        sesudah: { last_number: values.last_number },
        diturunkan: values.last_number < values.expected_last_number,
      },
    });

    return NextResponse.json({ success: true, kode: counter.kode, last_number: values.last_number });
  } catch (err) {
    console.error('Koreksi counter error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
