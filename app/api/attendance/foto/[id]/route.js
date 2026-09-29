import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { downloadAttendancePhotoFromDrive } from '@/lib/googleDrive';
import { DRIVE_REF_PREFIX, isValidDriveFileId } from '@/lib/attendancePhotoUrl';

// GET /api/attendance/foto/[id]
// Menyajikan foto absensi yang tersimpan di Google Drive. File Drive tidak bisa
// di-hotlink dari <img>, jadi admin membacanya lewat sini (session cookie).
//
// Tiga lapis pengaman, karena route ini membaca Drive dengan kredensial service account:
//   1. Hanya superadmin — sama dengan halaman rekap absensi.
//   2. [id] harus berbentuk ID file Drive (bukan input bebas).
//   3. [id] harus benar-benar tercatat sebagai foto di tabel attendance. Tanpa ini,
//      route bisa dipakai membaca file APA PUN yang bisa diakses service account.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!isValidDriveFileId(id)) {
      return NextResponse.json({ error: 'ID foto tidak valid.' }, { status: 400 });
    }

    const session = await getSessionEmployee('id, status, is_superadmin');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    if (!session.emp.is_superadmin) {
      return NextResponse.json({ error: 'Hanya superadmin yang boleh melihat foto absensi.' }, { status: 403 });
    }

    const ref = `${DRIVE_REF_PREFIX}${id}`;
    const admin = createAdminClient();
    const { data: row, error: lookupError } = await admin
      .from('attendance')
      .select('id')
      .or(`foto_clock_in_url.eq.${ref},foto_clock_out_url.eq.${ref}`)
      .limit(1)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!row) {
      return NextResponse.json({ error: 'Foto tidak ditemukan.' }, { status: 404 });
    }

    let photo;
    try {
      photo = await downloadAttendancePhotoFromDrive(id);
    } catch (driveError) {
      if (driveError?.code === 404 || driveError?.status === 404) {
        return NextResponse.json({ error: 'Foto tidak ditemukan di Drive.' }, { status: 404 });
      }
      throw driveError;
    }

    // Hanya jenis gambar yang dikenal; selain itu paksa jpeg + nosniff supaya
    // browser tidak menafsirkan isi file sebagai HTML/skrip.
    const contentType = /^image\/(jpeg|png)$/.test(photo.contentType) ? photo.contentType : 'image/jpeg';
    return new NextResponse(photo.buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(photo.buffer.length),
        'Cache-Control': 'private, max-age=3600', // foto tidak berubah; private = tidak di-cache proxy/CDN
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('Foto absensi proxy error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat membaca foto.' }, { status: 500 });
  }
}
