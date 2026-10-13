import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { PERATURAN_MODULE_KEY, LIMITS } from '@/lib/peraturanConfig';
import { uploadPeraturanPdfToDrive, deletePeraturanPdfFromDrive } from '@/lib/googleDrive';

// Route ini memakai service account Google, jadi RLS tidak berlaku: hak akses
// dicek manual. Tulis (unggah/hapus) = superadmin YANG memegang flag
// peraturan_ketenagakerjaan, sama dengan RLS tulis di tabel peraturan.
async function requireWriter(admin) {
  const access = await requireModuleAccess(admin, [PERATURAN_MODULE_KEY]);
  if (access.error) return access;
  if (!access.emp.is_superadmin) {
    return { error: 'Hanya superadmin yang boleh mengelola berkas peraturan.', status: 403 };
  }
  return access;
}

// Nama untuk ditampilkan & nama file di Drive: buang karakter kontrol dan
// pemisah path, rapikan spasi, batasi panjang, pastikan berakhiran .pdf.
function bersihkanNama(raw) {
  const base = String(raw || '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const tanpaEkstensi = base.replace(/\.pdf$/i, '').trim() || 'peraturan';
  const limited = Array.from(tanpaEkstensi).slice(0, LIMITS.pdfNama - 4).join('').trim();
  return `${limited}.pdf`;
}

// POST /api/peraturan/pdf  (multipart/form-data, field `file`)
// Mengunggah PDF ke Shared Drive Peraturan dan mengembalikan
// { fileId, nama, ukuran }. Route ini TIDAK menulis ke tabel peraturan: klien
// menyimpan fileId lewat sesinya sendiri (RLS + trigger updated_by tetap
// berlaku) dan memanggil DELETE di bawah kalau penyimpanan itu gagal.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireWriter(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

    const formData = await request.formData().catch(() => null);
    const file = formData?.get('file');
    if (!file || typeof file === 'string' || file.size === 0) {
      return NextResponse.json({ error: 'Berkas PDF wajib diunggah.' }, { status: 400 });
    }
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Format berkas harus PDF.' }, { status: 400 });
    }
    if (file.size > LIMITS.pdfBytes) {
      return NextResponse.json({ error: `Ukuran PDF maksimal ${LIMITS.pdfBytes / (1024 * 1024)} MB.` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Tipe dari browser bisa dipalsukan; periksa tanda tangan berkasnya juga.
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return NextResponse.json({ error: 'Isi berkas bukan PDF yang valid.' }, { status: 400 });
    }

    const nama = bersihkanNama(file.name);
    let fileId;
    try {
      ({ fileId } = await uploadPeraturanPdfToDrive(buffer, `${Date.now()}_${nama}`));
    } catch (driveError) {
      console.error('Upload PDF peraturan ke Drive gagal:', driveError);
      return NextResponse.json(
        { error: 'Gagal mengunggah PDF ke Google Drive. Coba lagi, atau hubungi admin sistem bila terus berulang.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ fileId, nama, ukuran: buffer.length });
  } catch (err) {
    console.error('Upload PDF peraturan error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat mengunggah PDF.' }, { status: 500 });
  }
}

// DELETE /api/peraturan/pdf  (JSON { fileId })
// Membersihkan berkas di Drive: PDF lama setelah diganti/dihapus, PDF yatim
// setelah penyimpanan baris gagal, atau PDF milik peraturan yang dihapus.
// Pengaman, karena fileId datang dari klien:
//   1. file harus ada di Shared Drive Peraturan (diperiksa di lib/googleDrive.js)
//   2. file yang MASIH dirujuk baris peraturan manapun tidak dihapus (409)
export async function DELETE(request) {
  try {
    const admin = createAdminClient();
    const access = await requireWriter(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

    const body = await request.json().catch(() => ({}));
    const fileId = typeof body?.fileId === 'string' ? body.fileId.trim() : '';
    if (!fileId || fileId.length > LIMITS.pdfDriveId || !/^[A-Za-z0-9_-]+$/.test(fileId)) {
      return NextResponse.json({ error: 'ID berkas tidak valid.' }, { status: 400 });
    }

    const { data: dipakai, error: refError } = await admin
      .from('peraturan')
      .select('id')
      .eq('pdf_drive_id', fileId)
      .limit(1);
    if (refError) throw refError;
    if (dipakai && dipakai.length > 0) {
      return NextResponse.json({ error: 'Berkas masih dipakai oleh sebuah peraturan.' }, { status: 409 });
    }

    try {
      await deletePeraturanPdfFromDrive(fileId);
    } catch (driveError) {
      // Sudah tidak ada (atau bukan milik drive ini) = tidak ada yang perlu dihapus.
      if (driveError?.code === 404 || driveError?.status === 404) return NextResponse.json({ ok: true });
      throw driveError;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Hapus PDF peraturan error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat menghapus PDF.' }, { status: 500 });
  }
}
