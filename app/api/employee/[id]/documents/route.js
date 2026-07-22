import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { uploadEmployeeDocumentToDrive, deleteEmployeeDocumentFromDrive } from '@/lib/googleDrive';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB — KTP/ijazah kadang hasil scan agak besar
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];

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
        { error: 'Hanya superadmin yang boleh mengelola dokumen employee.' },
        { status: 403 }
      ),
    };
  }

  return { user };
}

// POST /api/employee/[id]/documents — upload dokumen baru (KTP, PKWT, ijazah, dll)
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const { error: authError } = await getSupabaseAndRequester();
    if (authError) return authError;

    const admin = createAdminClient();

    // Ambil nama employee dari employees_master untuk dipakai sebagai nama subfolder di Drive
    const { data: empMaster, error: empError } = await admin
      .from('employees_master')
      .select('id, nama')
      .eq('id', id)
      .maybeSingle();

    if (empError || !empMaster) {
      return NextResponse.json({ error: 'Employee tidak ditemukan.' }, { status: 404 });
    }

    const formData = await request.formData();
    const namaDokumen = (formData.get('nama_dokumen') || '').toString().trim();
    const file = formData.get('file');

    if (!namaDokumen) {
      return NextResponse.json({ error: 'Nama dokumen wajib diisi.' }, { status: 400 });
    }
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'File wajib diupload.' }, { status: 400 });
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json(
        { error: 'Format file harus PDF, JPG, atau PNG.' },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Ukuran file maksimal 10MB.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const ext = file.name?.includes('.') ? file.name.split('.').pop() : 'pdf';
    const safeNamaDokumen = namaDokumen.replace(/[^a-zA-Z0-9]+/g, '_');
    const fileName = `${safeNamaDokumen}_${Date.now()}.${ext}`;
    const employeeFolderName = `${empMaster.nama} (${empMaster.id.slice(0, 8)})`;

    let uploadResult;
    try {
      uploadResult = await uploadEmployeeDocumentToDrive(fileBuffer, fileName, file.type, employeeFolderName);
    } catch (driveError) {
      console.error('Google Drive upload error:', driveError);
      return NextResponse.json(
        { error: 'Gagal mengupload dokumen ke Google Drive. Silakan coba lagi.' },
        { status: 500 }
      );
    }

    const { data: docRow, error: insertError } = await admin
      .from('employee_documents')
      .insert([{
        employee_id: id,
        nama_dokumen: namaDokumen,
        file_name: fileName,
        drive_file_id: uploadResult.fileId,
      }])
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: 'Dokumen berhasil diupload, tetapi gagal menyimpan metadata: ' + insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, document: docRow }, { status: 200 });
  } catch (err) {
    console.error('Employee documents upload error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

// DELETE /api/employee/[id]/documents?docId=xxx — hapus dokumen (Drive + row Supabase)
export async function DELETE(request, { params }) {
  try {
    const { error: authError } = await getSupabaseAndRequester();
    if (authError) return authError;

    const { searchParams } = new URL(request.url);
    const docId = searchParams.get('docId');
    if (!docId) {
      return NextResponse.json({ error: 'docId wajib diisi.' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: docRow } = await admin
      .from('employee_documents')
      .select('id, drive_file_id')
      .eq('id', docId)
      .maybeSingle();

    if (!docRow) {
      return NextResponse.json({ error: 'Dokumen tidak ditemukan.' }, { status: 404 });
    }

    try {
      await deleteEmployeeDocumentFromDrive(docRow.drive_file_id);
    } catch (driveError) {
      // Tidak fatal — kalau file sudah kehapus manual di Drive, tetap lanjut
      // hapus row-nya supaya tidak jadi data nyangkut.
      console.error('Gagal hapus file di Drive (lanjut hapus row):', driveError);
    }

    const { error: deleteError } = await admin.from('employee_documents').delete().eq('id', docId);
    if (deleteError) {
      return NextResponse.json(
        { error: 'Gagal menghapus data dokumen: ' + deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('Employee documents delete error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}