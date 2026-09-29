import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { todayJakarta } from '@/lib/serverTime';
import { precheckClock } from '@/lib/attendanceClock';
import { uploadAttendancePhotoToDrive } from '@/lib/googleDrive';
import { signFotoRef } from '@/lib/attendanceFotoRef';

const MAX_SIZE = 5 * 1024 * 1024; // foto kamera (JPEG 0.85) biasanya < 1MB; 5MB = batas aman
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png'];

// Jam Jakarta ringkas untuk nama file: 083015
function jamJakarta(now) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now).replace(/:/g, '');
}

// POST /api/attendance/foto  (multipart: file, mode = 'in' | 'out')
// Mengunggah foto clock in/out ke Google Drive (Shared Drive "Absensi") lewat server,
// lalu mengembalikan { fotoRef } bertanda tangan untuk disertakan saat clock in/out
// (lihat lib/attendanceFotoRef.js untuk alasan tanda tangan).
//
// Hanya boleh dipanggil kalau karyawan MEMANG sedang bisa clock in/out (precheckClock,
// aturan yang sama dengan preview/confirm) — mencegah endpoint ini dipakai menumpuk
// file di Drive tanpa absensi.
export async function POST(request) {
  try {
    const session = await getSessionEmployee('id, nama, status');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { emp } = session;

    const formData = await request.formData().catch(() => null);
    const file = formData?.get('file');
    const mode = (formData?.get('mode') || '').toString();

    if (mode !== 'in' && mode !== 'out') {
      return NextResponse.json({ error: 'mode harus "in" atau "out".' }, { status: 400 });
    }
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'Foto wajib diupload.' }, { status: 400 });
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json({ error: 'Format foto harus JPG atau PNG.' }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Ukuran foto maksimal 5MB.' }, { status: 400 });
    }

    const now = new Date();
    const tanggal = todayJakarta(now);

    const admin = createAdminClient();
    const pre = await precheckClock(admin, { empId: emp.id, mode, tanggal });
    if (pre.fail) {
      return NextResponse.json({ error: pre.fail.error }, { status: pre.fail.status });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const ext = file.type === 'image/png' ? 'png' : 'jpg';
    const fileName = `${tanggal}_${mode}_${jamJakarta(now)}.${ext}`;
    const employeeFolderName = `${emp.nama} (${String(emp.id).slice(0, 8)})`;
    const monthFolderName = tanggal.slice(0, 7);

    let uploaded;
    try {
      uploaded = await uploadAttendancePhotoToDrive(fileBuffer, fileName, file.type, employeeFolderName, monthFolderName);
    } catch (driveError) {
      console.error('Google Drive upload error (foto absensi):', driveError);
      return NextResponse.json({ error: 'Gagal mengupload foto ke Google Drive. Coba lagi.' }, { status: 500 });
    }

    return NextResponse.json({ fotoRef: signFotoRef(emp.id, uploaded.fileId) });
  } catch (err) {
    console.error('Foto absensi upload error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat menyimpan foto.' }, { status: 500 });
  }
}
