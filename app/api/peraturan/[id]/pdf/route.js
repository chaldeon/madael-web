import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { PERATURAN_MODULE_KEY } from '@/lib/peraturanConfig';
import { downloadPeraturanPdfFromDrive } from '@/lib/googleDrive';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/peraturan/[id]/pdf
// Menyajikan PDF peraturan dari Google Drive. File Drive tidak bisa di-hotlink,
// jadi dibaca lewat sini dengan sesi login.
//
// Pengaman, karena route ini membaca Drive dengan kredensial service account:
//   1. Hanya akun pemegang flag peraturan_ketenagakerjaan (superadmin pun harus
//      di-assign — modul ini explicit-only). Baca = semua pemegang flag.
//   2. File yang dibaca selalu pdf_drive_id dari baris peraturan, bukan ID dari
//      input pengguna; dan file harus berada di Shared Drive Peraturan.
//   3. Content-Type tetap application/pdf + nosniff, tidak diambil dari Drive.
// Semua penolakan "tidak ada" dijawab 404 yang sama.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID peraturan tidak valid.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, [PERATURAN_MODULE_KEY]);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

    const { data: row, error } = await admin
      .from('peraturan')
      .select('id, pdf_drive_id, pdf_nama')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!row || !row.pdf_drive_id) {
      return NextResponse.json({ error: 'Berkas PDF tidak ditemukan.' }, { status: 404 });
    }

    let buffer;
    try {
      buffer = await downloadPeraturanPdfFromDrive(row.pdf_drive_id);
    } catch (driveError) {
      if (driveError?.code === 404 || driveError?.status === 404) {
        return NextResponse.json({ error: 'Berkas PDF tidak ditemukan di Drive.' }, { status: 404 });
      }
      throw driveError;
    }

    const nama = row.pdf_nama || 'peraturan.pdf';
    const asciiNama = nama.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(buffer.length),
        'Content-Disposition': `inline; filename="${asciiNama}"; filename*=UTF-8''${encodeURIComponent(nama)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('PDF peraturan proxy error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat membaca berkas PDF.' }, { status: 500 });
  }
}
