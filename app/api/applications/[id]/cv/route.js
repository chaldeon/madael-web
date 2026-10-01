import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { isModuleGranted } from '@/lib/employeeModules';
import { downloadCVFromDrive } from '@/lib/googleDrive';
import { isValidDriveFileId } from '@/lib/attendancePhotoUrl';

// GET /api/applications/[id]/cv            -> PDF untuk preview inline
// GET /api/applications/[id]/cv?download=1 -> PDF sebagai unduhan
// [id] = applications.id (BUKAN id file Drive).
//
// File CV ada di Shared Drive yang hanya bisa dibaca service account, jadi
// reviewer membacanya lewat sini (session cookie) tanpa perlu akses Drive.
//
// Pengaman, karena route ini membaca Drive dengan kredensial service account:
//   1. Harus login, akun aktif, dan punya akses modul job_portal (atau superadmin).
//   2. Dicari lewat id lamaran, lalu file yang dibaca diambil dari baris itu —
//      bukan dari input client, jadi tidak bisa dipakai membaca file Drive lain.
//   3. CV diupload publik dan tipe filenya hanya dicek di sisi client, jadi isi
//      file dicek ulang ('%PDF-') dan selalu dilayani sebagai application/pdf + nosniff.
export async function GET(request, { params }) {
  try {
    const { id } = await params;

    const session = await getSessionEmployee('id, status, is_superadmin');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }

    const admin = createAdminClient();

    const { data: mods, error: modsError } = await admin
      .from('employee_modules')
      .select('module_name')
      .eq('employee_id', session.emp.id)
      .eq('module_name', 'job_portal');
    if (modsError) throw modsError;

    const allowed = isModuleGranted({
      isSuperadmin: session.emp.is_superadmin,
      moduleKeys: (mods || []).map((m) => m.module_name),
      key: 'job_portal',
    });
    if (!allowed) {
      return NextResponse.json({ error: 'Anda tidak punya akses ke modul Job Portal.' }, { status: 403 });
    }

    const { data: app, error: lookupError } = await admin
      .from('applications')
      .select('id, cv_drive_id, cv_filename')
      .eq('id', id)
      .maybeSingle();
    if (lookupError) {
      // 22P02 = id bukan format yang valid untuk kolom id
      if (lookupError.code === '22P02') {
        return NextResponse.json({ error: 'CV tidak ditemukan.' }, { status: 404 });
      }
      throw lookupError;
    }
    if (!app || !isValidDriveFileId(app.cv_drive_id)) {
      return NextResponse.json({ error: 'CV tidak ditemukan.' }, { status: 404 });
    }

    let buffer;
    try {
      buffer = await downloadCVFromDrive(app.cv_drive_id);
    } catch (driveError) {
      if (driveError?.code === 404 || driveError?.status === 404) {
        return NextResponse.json({ error: 'File CV tidak ditemukan di Drive.' }, { status: 404 });
      }
      throw driveError;
    }

    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return NextResponse.json({ error: 'File CV bukan PDF yang valid.' }, { status: 415 });
    }

    const asDownload = new URL(request.url).searchParams.get('download') === '1';
    const safeName = (app.cv_filename || 'cv.pdf').replace(/[^a-zA-Z0-9._-]+/g, '_');

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(buffer.length),
        'Content-Disposition': `${asDownload ? 'attachment' : 'inline'}; filename="${safeName}"`,
        'Cache-Control': 'private, max-age=600', // private = tidak di-cache proxy/CDN
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('Preview CV error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat membaca CV.' }, { status: 500 });
  }
}
