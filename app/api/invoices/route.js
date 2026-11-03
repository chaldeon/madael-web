import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { validateInvoiceBaru } from '@/lib/documentServer';
import {
  POLA_NOMOR_INVOICE,
  ambilNomorDokumen,
  kembalikanNomorDokumen,
} from '@/lib/documentNumberServer';

// POST /api/invoices
//   body: { nominal, nomor_surat?, client_id?, tanggal_terbit?, catatan? }
//
// Tambah invoice dari Invoice & Billing Tracker (khusus superadmin, sama
// dengan halamannya). Dulu browser meng-insert langsung dan nomor invoice
// SELALU diketik manual, padahal jenis INV sudah punya counter otomatis —
// nomor manual bisa bentrok dengan nomor otomatis (slip gaji juga memakai
// counter INV).
//
// Aturan nomor:
// - nomor_surat dikosongkan -> nomor otomatis dari counter INV (INV/tahun/NNN);
//   dikembalikan ke counter bila insert gagal.
// - nomor_surat diisi (invoice lama / format di luar sistem) -> tetap
//   diterima, tetapi ditolak kalau sudah dipakai invoice, dokumen, atau slip
//   gaji lain, atau kalau berformat otomatis dengan urutan di atas counter
//   (akan bentrok saat counter sampai di sana).
async function nomorSudahDipakai(admin, nomor) {
  const cek = [
    ['invoices', 'nomor_surat'],
    ['documents', 'nomor_surat'],
    ['payslips', 'nomor_dokumen'],
  ];
  for (const [tabel, kolom] of cek) {
    const { data, error } = await admin.from(tabel).select('id').eq(kolom, nomor).limit(1);
    if (error) throw error;
    if ((data || []).length > 0) return true;
  }
  return false;
}

export async function POST(request) {
  try {
    const session = await getSessionEmployee('id, nama, status, is_superadmin');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { emp } = session;
    if (!emp.is_superadmin) {
      return NextResponse.json(
        { error: 'Hanya superadmin yang boleh menambah invoice.' },
        { status: 403 }
      );
    }

    const admin = createAdminClient();

    const body = await request.json().catch(() => null);
    const { values, error: validationError } = validateInvoiceBaru(body);
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
          { error: `Gagal memeriksa klien: ${friendlyError(clientError, 'terjadi kesalahan pada server.', { context: 'Cek klien invoice' })}` },
          { status: 500 }
        );
      }
      // 22P02 = client_id bukan format id yang valid
      if (clientError || !client) {
        return NextResponse.json({ error: 'Klien tidak ditemukan.' }, { status: 400 });
      }
    }

    // Nomor manual: cek bentrok SEBELUM insert.
    if (values.nomor_manual) {
      const manual = values.nomor_manual;

      const match = manual.match(POLA_NOMOR_INVOICE);
      if (match) {
        const { data: counter, error: counterError } = await admin
          .from('document_counters')
          .select('last_number')
          .eq('kode', 'INV')
          .maybeSingle();
        if (counterError) {
          return NextResponse.json(
            { error: `Gagal memeriksa counter: ${friendlyError(counterError, 'terjadi kesalahan pada server.', { context: 'Cek counter INV' })}` },
            { status: 500 }
          );
        }
        if (counter && Number(match[2]) > Number(counter.last_number)) {
          return NextResponse.json(
            { error: 'Nomor ini berformat nomor otomatis tetapi melebihi urutan terakhir, sehingga akan bentrok nanti. Kosongkan kolom Nomor Surat untuk membuat nomor otomatis.' },
            { status: 400 }
          );
        }
      }

      let dipakai;
      try {
        dipakai = await nomorSudahDipakai(admin, manual);
      } catch (err) {
        return NextResponse.json(
          { error: `Gagal memeriksa nomor: ${friendlyError(err, 'terjadi kesalahan pada server.', { context: 'Cek nomor invoice' })}` },
          { status: 500 }
        );
      }
      if (dipakai) {
        return NextResponse.json(
          { error: 'Nomor surat ini sudah dipakai oleh invoice, dokumen, atau slip gaji lain.' },
          { status: 409 }
        );
      }
    }

    // Nomor otomatis diambil HANYA setelah semua validasi lolos.
    let nomorOtomatis = null;
    if (!values.nomor_manual) {
      try {
        nomorOtomatis = await ambilNomorDokumen(admin, 'INV');
      } catch (err) {
        return NextResponse.json(
          { error: `Gagal generate nomor invoice: ${friendlyError(err, 'terjadi kesalahan pada server.', { context: 'Generate nomor invoice' })}` },
          { status: 500 }
        );
      }
    }
    const nomorSurat = values.nomor_manual || nomorOtomatis.nomor;

    const { data: inserted, error: insertError } = await admin
      .from('invoices')
      .insert([{
        client_id: values.client_id,
        nomor_surat: nomorSurat,
        nominal: values.nominal,
        tanggal_terbit: values.tanggal_terbit,
        catatan: values.catatan,
        status: 'draft',
        created_by: emp.id,
      }])
      .select()
      .single();

    if (insertError || !inserted) {
      if (nomorOtomatis) {
        const dikembalikan = await kembalikanNomorDokumen(admin, nomorOtomatis.counter, nomorOtomatis.urutan);
        if (!dikembalikan) {
          await logActivity(admin, {
            userId: emp.id,
            aksi: 'nomor_invoice_hangus',
            targetTable: 'document_counters',
            detail: { nomor_surat: nomorSurat, client_id: values.client_id },
          });
        }
      }
      return NextResponse.json(
        { error: `Gagal menambahkan invoice: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Buat invoice' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'buat_invoice',
      targetTable: 'invoices',
      targetId: inserted.id,
      detail: {
        nomor_surat: nomorSurat,
        nomor_otomatis: !!nomorOtomatis,
        nominal: values.nominal,
        client_id: values.client_id,
      },
    });

    return NextResponse.json({ success: true, invoice: inserted });
  } catch (err) {
    console.error('Buat invoice error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
