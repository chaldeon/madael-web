import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { downloadFreelancerFileFromDrive } from '@/lib/googleDrive';
import { deteksiMimeDariIsi } from '@/lib/uploadServer';
import { UUID_RE, jsonError, gerbangFreelancerAdmin } from '@/lib/freelancerAdminServer';
import { AGREEMENT_DOKUMEN_KOLOM, driveIdFromAgreementRef } from '@/lib/freelancerAgreementConfig';

const EKSTENSI = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

// GET /api/freelancers/[id]/agreement/asli | bertanda-tangan — membuka dokumen
// Agreement. File Drive tidak bisa di-hotlink dan tidak semua tim punya akses Shared
// Drive, jadi dibaca server dengan service account. Pengaman: hanya pemegang modul
// `freelancer_admin`; segmen [dokumen] hanya memilih KOLOM (daftar putih); id file
// Drive selalu dari baris Agreement milik Freelancer [id], bukan dari input pengguna.
export async function GET(request, { params }) {
  try {
    const { id, dokumen } = await params;
    if (!UUID_RE.test(String(id || ''))) return jsonError('ID Freelancer tidak valid.', 400);
    const kolom = Object.prototype.hasOwnProperty.call(AGREEMENT_DOKUMEN_KOLOM, dokumen) ? AGREEMENT_DOKUMEN_KOLOM[dokumen] : null;
    if (!kolom) return jsonError('Jenis dokumen tidak valid.', 400);

    const admin = createAdminClient();
    const gate = await gerbangFreelancerAdmin(admin);
    if (gate.error) return jsonError(gate.error, gate.status);

    const { data: fl, error: flError } = await admin
      .from('freelancers')
      .select('freelancer_code')
      .eq('id', id)
      .maybeSingle();
    if (flError) throw flError;
    if (!fl) return jsonError('Freelancer tidak ditemukan.', 404);

    const { data: row, error } = await admin
      .from('freelancer_agreements')
      .select(kolom)
      .eq('freelancer_id', id)
      .maybeSingle();
    if (error) throw error;
    const fileId = driveIdFromAgreementRef(row?.[kolom]);
    if (!fileId) {
      return jsonError(
        dokumen === 'asli' ? 'Dokumen Agreement belum diunggah.' : 'Dokumen bertanda tangan belum diunggah.',
        404
      );
    }

    let buffer;
    try {
      buffer = await downloadFreelancerFileFromDrive(fileId);
    } catch (driveError) {
      if (driveError?.code === 404 || driveError?.status === 404) {
        return jsonError('File Agreement tidak ditemukan di Drive.', 404);
      }
      throw driveError;
    }

    // Tipe konten dari isi file (bukan dari input), + nosniff.
    const mime = deteksiMimeDariIsi(buffer);
    const ext = mime ? EKSTENSI[mime] : null;
    const namaFile = `Agreement_${fl.freelancer_code}_${dokumen}${ext ? `.${ext}` : ''}`;
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': mime || 'application/octet-stream',
        'Content-Length': String(buffer.length),
        'Content-Disposition': `${mime ? 'inline' : 'attachment'}; filename="${namaFile}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('GET /api/freelancers/[id]/agreement/[dokumen] error:', err);
    return jsonError('Terjadi kesalahan server saat membuka dokumen Agreement.', 500);
  }
}
