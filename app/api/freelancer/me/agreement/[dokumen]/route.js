import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { downloadFreelancerFileFromDrive } from '@/lib/googleDrive';
import { deteksiMimeDariIsi } from '@/lib/uploadServer';
import { requireFreelancerModule } from '@/lib/freelancerAccessServer';
import { jsonError } from '@/lib/freelancerAdminServer';
import { AGREEMENT_DOKUMEN_KOLOM, driveIdFromAgreementRef } from '@/lib/freelancerAgreementConfig';

const EKSTENSI = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

// Segmen yang boleh dibuka Freelancer: hanya dokumen ASLI miliknya (sesuai brief
// FRE-TOOL-04). Dokumen bertanda tangan sengaja belum dibuka; bila diputuskan perlu,
// tambahkan 'bertanda-tangan' di sini (kolomnya sudah ada di AGREEMENT_DOKUMEN_KOLOM).
const DOKUMEN_FREELANCER = ['asli'];

// GET /api/freelancer/me/agreement/asli — Freelancer mengunduh dokumen Agreement
// aslinya sendiri. File Drive tidak bisa di-hotlink, jadi dibaca server dengan
// service account. Pengaman: id Freelancer dari sesi (tidak ada parameter id dari
// klien); segmen [dokumen] hanya memilih KOLOM lewat daftar putih; id file Drive
// selalu dari baris Agreement milik Freelancer yang login, bukan dari input pengguna.
export async function GET(request, { params }) {
  try {
    const { dokumen } = await params;
    const kolom =
      DOKUMEN_FREELANCER.includes(dokumen) && Object.prototype.hasOwnProperty.call(AGREEMENT_DOKUMEN_KOLOM, dokumen)
        ? AGREEMENT_DOKUMEN_KOLOM[dokumen]
        : null;
    if (!kolom) return jsonError('Jenis dokumen tidak valid.', 400);

    const admin = createAdminClient();
    // Profil Saya tidak gated: Agreement harus bisa dibuka sebelum gate terbuka.
    const gate = await requireFreelancerModule(admin, ['freelancer_profile']);
    if (gate.error) return jsonError(gate.error, gate.status);
    const { freelancer } = gate;

    const { data: row, error } = await admin
      .from('freelancer_agreements')
      .select(kolom)
      .eq('freelancer_id', freelancer.id)
      .maybeSingle();
    if (error) throw error;
    const fileId = driveIdFromAgreementRef(row?.[kolom]);
    if (!fileId) return jsonError('Dokumen Agreement kamu belum tersedia.', 404);

    let buffer;
    try {
      buffer = await downloadFreelancerFileFromDrive(fileId);
    } catch (driveError) {
      if (driveError?.code === 404 || driveError?.status === 404) {
        return jsonError('File Agreement tidak ditemukan. Silakan hubungi Tim Internal Madael.', 404);
      }
      throw driveError;
    }

    // Tipe konten dari isi file (bukan dari input), + nosniff.
    const mime = deteksiMimeDariIsi(buffer);
    const ext = mime ? EKSTENSI[mime] : null;
    const namaFile = `Agreement_${freelancer.freelancer_code}_${dokumen}${ext ? `.${ext}` : ''}`;
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
    console.error('GET /api/freelancer/me/agreement/[dokumen] error:', err);
    return jsonError('Terjadi kesalahan server saat membuka dokumen Agreement.', 500);
  }
}
