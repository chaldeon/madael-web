import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { uploadInvoiceFileToDrive, deleteInvoiceFileFromDrive } from '@/lib/googleDrive';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = ['application/pdf'];

async function getSupabaseAndRequester() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // no-op — route ini tidak perlu set cookie baru
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Belum login.' }, { status: 401 }) };

  const { data: requester } = await supabase
    .from('employees')
    .select('is_superadmin')
    .eq('email', user.email)
    .maybeSingle();

  if (!requester?.is_superadmin) {
    return {
      error: NextResponse.json(
        { error: 'Hanya superadmin yang boleh mengelola lampiran invoice.' },
        { status: 403 }
      ),
    };
  }

  return { user };
}

// POST /api/invoices/[id]/attachment — upload/ganti file PDF invoice
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const { error: authError } = await getSupabaseAndRequester();
    if (authError) return authError;

    const admin = createAdminClient();

    const { data: invoice, error: invError } = await admin
      .from('invoices')
      .select('id, nomor_surat, client_id, drive_file_id, companies:client_id (nama_perusahaan)')
      .eq('id', id)
      .maybeSingle();

    if (invError || !invoice) {
      return NextResponse.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'File wajib diupload.' }, { status: 400 });
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json({ error: 'Format file harus PDF.' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Ukuran file maksimal 10MB.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const safeNomor = (invoice.nomor_surat || id).replace(/[^a-zA-Z0-9]+/g, '_');
    const fileName = `${safeNomor}_${Date.now()}.pdf`;
    const clientFolderName = invoice.companies?.nama_perusahaan || null;

    let uploadResult;
    try {
      uploadResult = await uploadInvoiceFileToDrive(fileBuffer, fileName, file.type, clientFolderName);
    } catch (driveError) {
      console.error('Google Drive upload error:', driveError);
      return NextResponse.json(
        { error: 'Gagal mengupload file ke Google Drive. Silakan coba lagi.' },
        { status: 500 }
      );
    }

    // Kalau sebelumnya sudah ada lampiran, hapus yang lama dari Drive supaya
    // tidak menumpuk file basi di Shared Drive.
    if (invoice.drive_file_id) {
      try {
        await deleteInvoiceFileFromDrive(invoice.drive_file_id);
      } catch (cleanupError) {
        console.error('Gagal hapus lampiran lama:', cleanupError);
      }
    }

    const { data: updated, error: updateError } = await admin
      .from('invoices')
      .update({
        drive_file_id: uploadResult.fileId,
        drive_file_name: fileName,
        drive_file_link: uploadResult.webViewLink,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: 'File berhasil diupload, tetapi gagal menyimpan metadata: ' + updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ invoice: updated });
  } catch (err) {
    console.error('Upload lampiran invoice error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}

// DELETE /api/invoices/[id]/attachment — hapus lampiran PDF invoice
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const { error: authError } = await getSupabaseAndRequester();
    if (authError) return authError;

    const admin = createAdminClient();

    const { data: invoice, error: invError } = await admin
      .from('invoices')
      .select('id, drive_file_id')
      .eq('id', id)
      .maybeSingle();

    if (invError || !invoice) {
      return NextResponse.json({ error: 'Invoice tidak ditemukan.' }, { status: 404 });
    }

    if (invoice.drive_file_id) {
      try {
        await deleteInvoiceFileFromDrive(invoice.drive_file_id);
      } catch (driveError) {
        console.error('Gagal hapus file dari Drive:', driveError);
      }
    }

    const { data: updated, error: updateError } = await admin
      .from('invoices')
      .update({
        drive_file_id: null,
        drive_file_name: null,
        drive_file_link: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ invoice: updated });
  } catch (err) {
    console.error('Hapus lampiran invoice error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}