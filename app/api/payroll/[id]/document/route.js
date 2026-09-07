import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { uploadPayrollDocumentToDrive, deletePayrollDocumentFromDrive } from '@/lib/googleDrive';

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
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
        { error: 'Hanya superadmin yang boleh mengelola dokumen payroll.' },
        { status: 403 }
      ),
    };
  }

  return { user };
}

// POST /api/payroll/[id]/document — upload/ganti dokumen payroll (SK gaji, kontrak, dll)
// [id] = id baris employees_master
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const { error: authError } = await getSupabaseAndRequester();
    if (authError) return authError;

    const admin = createAdminClient();

    const { data: empMaster, error: empError } = await admin
      .from('employees_master')
      .select('id, nama, drive_file_id')
      .eq('id', id)
      .maybeSingle();

    if (empError || !empMaster) {
      return NextResponse.json({ error: 'Employee tidak ditemukan.' }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

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
    const fileName = `${(empMaster.nama || 'employee').replace(/[^a-zA-Z0-9]+/g, '_')}_${Date.now()}.${ext}`;
    const employeeFolderName = `${empMaster.nama} (${empMaster.id.slice(0, 8)})`;

    let uploadResult;
    try {
      uploadResult = await uploadPayrollDocumentToDrive(fileBuffer, fileName, file.type, employeeFolderName);
    } catch (driveError) {
      console.error('Google Drive upload error:', driveError);
      return NextResponse.json(
        { error: 'Gagal mengupload dokumen ke Google Drive. Silakan coba lagi.' },
        { status: 500 }
      );
    }

    // Kalau sebelumnya sudah ada dokumen, hapus yang lama dari Drive supaya
    // tidak menumpuk file basi di Shared Drive.
    if (empMaster.drive_file_id) {
      try {
        await deletePayrollDocumentFromDrive(empMaster.drive_file_id);
      } catch (cleanupError) {
        console.error('Gagal hapus dokumen lama:', cleanupError);
      }
    }

    const { data: updated, error: updateError } = await admin
      .from('employees_master')
      .update({
        drive_file_id: uploadResult.fileId,
        drive_file_name: fileName,
        drive_file_link: uploadResult.webViewLink,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: 'Dokumen berhasil diupload, tetapi gagal menyimpan metadata: ' + updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ employee: updated });
  } catch (err) {
    console.error('Upload dokumen payroll error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}

// DELETE /api/payroll/[id]/document — hapus dokumen payroll
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const { error: authError } = await getSupabaseAndRequester();
    if (authError) return authError;

    const admin = createAdminClient();

    const { data: empMaster, error: empError } = await admin
      .from('employees_master')
      .select('id, drive_file_id')
      .eq('id', id)
      .maybeSingle();

    if (empError || !empMaster) {
      return NextResponse.json({ error: 'Employee tidak ditemukan.' }, { status: 404 });
    }

    if (empMaster.drive_file_id) {
      try {
        await deletePayrollDocumentFromDrive(empMaster.drive_file_id);
      } catch (driveError) {
        console.error('Gagal hapus file dari Drive:', driveError);
      }
    }

    const { data: updated, error: updateError } = await admin
      .from('employees_master')
      .update({
        drive_file_id: null,
        drive_file_name: null,
        drive_file_link: null,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ employee: updated });
  } catch (err) {
    console.error('Hapus dokumen payroll error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}