import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { uploadCVToDrive } from '@/lib/googleDrive';

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request) {
  try {
    const formData = await request.formData();

    const nama = (formData.get('nama') || '').toString().trim();
    const email = (formData.get('email') || '').toString().trim();
    const telepon = (formData.get('telepon') || '').toString().trim();
    const jobId = (formData.get('job_id') || '').toString().trim();
    const positionName = (formData.get('posisi') || '').toString().trim();
    const file = formData.get('cv');

    // Validasi dasar
    if (!nama || !email || !jobId || !file) {
      return NextResponse.json(
        { error: 'Nama, email, posisi, dan file CV wajib diisi.' },
        { status: 400 }
      );
    }

    if (typeof file === 'string') {
      return NextResponse.json({ error: 'File CV tidak valid.' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'File CV harus berformat PDF.' }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Ukuran file CV maksimal 5MB.' }, { status: 400 });
    }

    // Siapkan file untuk diupload
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const safeNama = nama.replace(/[^a-zA-Z0-9]+/g, '_');
    const fileName = `${safeNama}_${Date.now()}.pdf`;

    // Upload ke Google Drive (folder otomatis per posisi)
    let cvDriveId;
    try {
      cvDriveId = await uploadCVToDrive(fileBuffer, fileName, positionName || 'Lainnya');
    } catch (driveError) {
      console.error('Google Drive upload error:', driveError);
      return NextResponse.json(
        { error: 'Gagal mengupload CV ke Google Drive. Silakan coba lagi.' },
        { status: 500 }
      );
    }

    // Simpan record pelamar ke Supabase
    // Catatan: tidak pakai .select() di sini karena role "anon" (dipakai lewat
    // anon key yang publik) sengaja tidak diberi izin RLS untuk SELECT pada
    // tabel applications -- data pelamar (nama/email/telepon) tidak seharusnya
    // bisa dibaca langsung dari client manapun.
    const { error } = await supabase.from('applications').insert([
      {
        job_id: jobId,
        nama,
        email,
        telepon: telepon || null,
        cv_drive_id: cvDriveId,
        cv_filename: fileName,
        status: 'Baru',
      },
    ]);

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json(
        { error: 'CV berhasil diupload, tetapi gagal menyimpan data pelamar. Hubungi admin.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('Apply API unexpected error:', err);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server. Silakan coba lagi.' },
      { status: 500 }
    );
  }
}