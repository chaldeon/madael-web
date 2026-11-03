import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { validateDokumenBaru } from '@/lib/documentServer';
import { ambilNomorDokumen, kembalikanNomorDokumen } from '@/lib/documentNumberServer';

// POST /api/documents
//   body: { kode_jenis, judul, content, client_id?, tanggal_dokumen?, catatan? }
//
// Satu-satunya jalan membuat dokumen baru dari form Dokumen Baru. Dulu browser
// memanggil /api/documents/generate-number lalu meng-insert ke tabel documents
// sendiri: nomor surat hangus kalau insert gagal, validasi hanya di form, dan
// pembuatan dokumen tidak tercatat di activity log.
//
// Di sini: hak modul dicek (sama dengan layout Documents), body divalidasi,
// klien dicek, nomor surat diambil HANYA setelah semua validasi lolos, nomor
// dikembalikan ke counter bila insert tetap gagal, created_by diambil dari
// sesi (bukan dari klien), dan pembuatan dicatat di activity log.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['document_generator', 'nomor_surat']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => null);
    const { values, error: validationError } = validateDokumenBaru(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    if (values.client_id) {
      const { data: client, error: clientError } = await admin
        .from('companies')
        .select('id')
        .eq('id', values.client_id)
        .maybeSingle();
      if (clientError && clientError.code !== '22P02') {
        return NextResponse.json(
          { error: `Gagal memeriksa klien: ${friendlyError(clientError, 'terjadi kesalahan pada server.', { context: 'Cek klien dokumen' })}` },
          { status: 500 }
        );
      }
      // 22P02 = client_id bukan format id yang valid
      if (clientError || !client) {
        return NextResponse.json({ error: 'Klien tidak ditemukan.' }, { status: 400 });
      }
    }

    // Semua validasi sudah lolos — baru sekarang nomor diambil.
    let nomor;
    try {
      nomor = await ambilNomorDokumen(admin, values.kode_jenis);
    } catch (err) {
      return NextResponse.json(
        { error: `Gagal generate nomor surat: ${friendlyError(err, 'terjadi kesalahan pada server.', { context: 'Generate nomor surat' })}` },
        { status: 500 }
      );
    }

    const { data: inserted, error: insertError } = await admin
      .from('documents')
      .insert({
        nomor_surat: nomor.nomor,
        kode_jenis: values.kode_jenis,
        judul: values.judul,
        client_id: values.client_id,
        created_by: emp.id,
        status: 'Draft',
        content: values.content,
        catatan: values.catatan,
        tanggal_dokumen: values.tanggal_dokumen,
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      const dikembalikan = await kembalikanNomorDokumen(admin, nomor.counter, nomor.urutan);
      if (!dikembalikan) {
        // Nomor sudah diambil pihak lain sesudahnya (atau counter tidak bisa
        // diubah) sehingga jadi celah di urutan; dicatat supaya bisa dijelaskan.
        await logActivity(admin, {
          userId: emp.id,
          aksi: 'nomor_surat_hangus',
          targetTable: 'document_counters',
          detail: { nomor_surat: nomor.nomor, kode_jenis: values.kode_jenis, judul: values.judul },
        });
      }
      return NextResponse.json(
        { error: `Gagal menyimpan dokumen: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Buat dokumen' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'buat_dokumen',
      targetTable: 'documents',
      targetId: inserted.id,
      detail: { nomor_surat: nomor.nomor, kode_jenis: values.kode_jenis, judul: values.judul, client_id: values.client_id },
    });

    return NextResponse.json({ success: true, id: inserted.id, nomor_surat: nomor.nomor });
  } catch (err) {
    console.error('Buat dokumen error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
