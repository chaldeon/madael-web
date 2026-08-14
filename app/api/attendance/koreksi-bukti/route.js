import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { uploadAttendanceEvidenceToDrive } from '@/lib/googleDrive';

const MAX_SIZE = 5 * 1024 * 1024; // 5MB — cukup untuk foto bukti kehadiran
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png'];

// POST /api/attendance/koreksi-bukti — upload foto bukti pengajuan koreksi
// absensi mandiri ke Google Drive (Shared Drive "Absensi"). Siapa saja
// employee aktif yang login boleh upload, karena ini dipakai karyawan
// sendiri saat mengajukan koreksi kehadiran mereka.
export async function POST(request) {
  try {
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
            // no-op — route ini cuma butuh baca session, tidak refresh cookie
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum login.' }, { status: 401 });
    }

    const { data: emp } = await supabase
      .from('employees')
      .select('id, nama, status')
      .eq('email', user.email)
      .maybeSingle();

    if (!emp || emp.status !== 'Aktif') {
      return NextResponse.json({ error: 'Akun tidak aktif.' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const tanggal = (formData.get('tanggal') || '').toString();

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Foto bukti wajib diupload.' }, { status: 400 });
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json({ error: 'Format foto harus JPG atau PNG.' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Ukuran foto maksimal 5MB.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const ext = file.type === 'image/png' ? 'png' : 'jpg';
    const fileName = `bukti_${tanggal || 'koreksi'}_${Date.now()}.${ext}`;
    const employeeFolderName = `${emp.nama} (${emp.id.slice(0, 8)})`;

    let uploadResult;
    try {
      uploadResult = await uploadAttendanceEvidenceToDrive(fileBuffer, fileName, file.type, employeeFolderName);
    } catch (driveError) {
      console.error('Google Drive upload error (koreksi absensi):', driveError);
      return NextResponse.json(
        { error: 'Gagal mengupload foto bukti ke Google Drive. Coba lagi.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      driveFileId: uploadResult.fileId,
      driveUrl: uploadResult.webViewLink,
    });
  } catch (err) {
    console.error('Koreksi bukti upload error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}