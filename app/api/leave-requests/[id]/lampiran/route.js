import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { downloadLeaveAttachmentFromDrive } from '@/lib/googleDrive';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPE_KONTEN = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };

// GET /api/leave-requests/[id]/lampiran
// Menyajikan lampiran pengajuan cuti (surat dokter dll) dari Google Drive.
// File Drive tidak bisa di-hotlink, jadi dibaca lewat sini dengan sesi login.
//
// Pengaman, karena route ini membaca Drive dengan kredensial service account:
//   1. Hanya superadmin ATAU pemilik pengajuan (surat dokter = data pribadi).
//   2. File yang dibaca selalu lampiran_drive_id dari baris leave_requests,
//      bukan ID dari input pengguna — tidak bisa dipakai membaca file lain.
//   3. Tipe konten ditentukan dari nama file buatan server (bukan dari Drive),
//      ditambah nosniff, supaya isi file tidak ditafsirkan sebagai HTML/skrip.
// Pemilik lain dijawab 404 (sama seperti baris tidak ada) agar tidak membocorkan
// keberadaan pengajuan orang lain.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID pengajuan tidak valid.' }, { status: 400 });
    }

    const session = await getSessionEmployee('id, status, is_superadmin');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { emp } = session;

    const admin = createAdminClient();
    const { data: row, error } = await admin
      .from('leave_requests')
      .select('id, employee_id, lampiran_drive_id, lampiran_nama')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;

    if (!row || !row.lampiran_drive_id || (!emp.is_superadmin && row.employee_id !== emp.id)) {
      return NextResponse.json({ error: 'Lampiran tidak ditemukan.' }, { status: 404 });
    }

    let buffer;
    try {
      buffer = await downloadLeaveAttachmentFromDrive(row.lampiran_drive_id);
    } catch (driveError) {
      if (driveError?.code === 404 || driveError?.status === 404) {
        return NextResponse.json({ error: 'Lampiran tidak ditemukan di Drive.' }, { status: 404 });
      }
      throw driveError;
    }

    const ext = (row.lampiran_nama || '').split('.').pop().toLowerCase();
    const contentType = TIPE_KONTEN[ext] || 'application/octet-stream';
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `${TIPE_KONTEN[ext] ? 'inline' : 'attachment'}; filename="${row.lampiran_nama || 'lampiran'}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('Lampiran cuti proxy error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat membaca lampiran.' }, { status: 500 });
  }
}
