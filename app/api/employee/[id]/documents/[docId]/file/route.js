import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { downloadEmployeeDocumentFromDrive } from '@/lib/googleDrive';
import {
  DOC_ID_RE,
  STORAGE_BUCKET,
  authorizeEmployeeDocuments,
  tipeKonten,
} from '@/lib/employeeDocumentsServer';

// GET /api/employee/[id]/documents/[docId]/file
// Membuka dokumen karyawan. Satu pintu untuk dua penyimpanan:
//   - Google Drive : file Drive tidak bisa di-hotlink (dan tidak semua orang
//     punya akses Shared Drive), jadi dibaca server dengan service account.
//   - Supabase Storage (baris lama): dialihkan ke signed URL 5 menit; tidak
//     di-proxy karena file lama boleh sampai 10MB (> batas respons serverless).
//
// Pengaman, karena route ini memakai kredensial service account:
//   1. Hanya superadmin atau pemilik dokumen (authorizeEmployeeDocuments).
//   2. File yang dibaca selalu drive_file_id / file_path dari baris
//      employee_documents milik karyawan [id], bukan ID dari input pengguna.
//   3. Tipe konten dari nama file buatan server + nosniff.
export async function GET(request, { params }) {
  try {
    const { id, docId } = await params;
    if (!DOC_ID_RE.test(String(docId || ''))) {
      return NextResponse.json({ error: 'ID dokumen tidak valid.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const auth = await authorizeEmployeeDocuments(admin, id);
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
    const { target } = auth;

    const { data: row, error } = await admin
      .from('employee_documents')
      .select('*')
      .eq('id', docId)
      .in('employee_id', target.keys)
      .maybeSingle();
    if (error) throw error;
    if (!row || (!row.drive_file_id && !row.file_path)) {
      return NextResponse.json({ error: 'Dokumen tidak ditemukan.' }, { status: 404 });
    }

    if (!row.drive_file_id) {
      const { data: signed, error: signError } = await admin.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(row.file_path, 60 * 5);
      if (signError || !signed?.signedUrl) {
        return NextResponse.json({ error: 'File dokumen tidak ditemukan.' }, { status: 404 });
      }
      const redirect = NextResponse.redirect(signed.signedUrl, 302);
      redirect.headers.set('Cache-Control', 'private, no-store');
      return redirect;
    }

    let buffer;
    try {
      buffer = await downloadEmployeeDocumentFromDrive(row.drive_file_id);
    } catch (driveError) {
      if (driveError?.code === 404 || driveError?.status === 404) {
        return NextResponse.json({ error: 'File dokumen tidak ditemukan di Drive.' }, { status: 404 });
      }
      throw driveError;
    }

    const namaFile = row.file_name || 'dokumen';
    const contentType = tipeKonten(namaFile);
    const namaAscii = namaFile.replace(/[^\x20-\x7E]|["\\]/g, '_');
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Length': String(buffer.length),
        'Content-Disposition': `${contentType ? 'inline' : 'attachment'}; filename="${namaAscii}"; filename*=UTF-8''${encodeURIComponent(namaFile)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('Dokumen karyawan proxy error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat membuka dokumen.' }, { status: 500 });
  }
}
