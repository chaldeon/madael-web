import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { uploadFreelancerFileToDrive, downloadFreelancerFileFromDrive } from '@/lib/googleDrive';
import { deteksiMimeDariIsi } from '@/lib/uploadServer';
import { cvRefFromDriveId, driveIdFromCvRef } from '@/lib/freelancerAdminConfig';
import { UUID_RE, jsonError, gerbangFreelancerAdmin, periksaCv } from '@/lib/freelancerAdminServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';

const EKSTENSI = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

// GET /api/freelancers/[id]/cv — membuka CV Freelancer. File Drive tidak bisa
// di-hotlink dan tidak semua tim punya akses Shared Drive, jadi dibaca server
// dengan service account. Pengaman: hanya pemegang modul `freelancer_admin`, dan
// file yang dibaca selalu id dari baris freelancers [id], bukan dari input pengguna.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(String(id || ''))) return jsonError('ID Freelancer tidak valid.', 400);

    const admin = createAdminClient();
    const gate = await gerbangFreelancerAdmin(admin);
    if (gate.error) return jsonError(gate.error, gate.status);

    const { data: row, error } = await admin
      .from('freelancers')
      .select('freelancer_code, cv_url')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    const fileId = driveIdFromCvRef(row?.cv_url);
    if (!row || !fileId) return jsonError('CV belum diunggah.', 404);

    let buffer;
    try {
      buffer = await downloadFreelancerFileFromDrive(fileId);
    } catch (driveError) {
      if (driveError?.code === 404 || driveError?.status === 404) {
        return jsonError('File CV tidak ditemukan di Drive.', 404);
      }
      throw driveError;
    }

    // Tipe konten dari isi file (bukan dari input), + nosniff.
    const mime = deteksiMimeDariIsi(buffer);
    const ext = mime ? EKSTENSI[mime] : null;
    const namaFile = `CV_${row.freelancer_code}${ext ? `.${ext}` : ''}`;
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
    console.error('GET /api/freelancers/[id]/cv error:', err);
    return jsonError('Terjadi kesalahan server saat membuka CV.', 500);
  }
}

// POST /api/freelancers/[id]/cv — unggah CV (menambah, atau mengganti yang lama).
// FormData: file (PDF/JPG/PNG, maks 4MB; isi file diperiksa dari byte awalnya).
// CV lama TIDAK dihapus dari Drive: hanya penunjuknya yang diganti, dan id file
// lama dicatat di activity log (jejak, bisa dipulihkan).
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(String(id || ''))) return jsonError('ID Freelancer tidak valid.', 400);

    const admin = createAdminClient();
    const gate = await gerbangFreelancerAdmin(admin);
    if (gate.error) return jsonError(gate.error, gate.status);
    const { emp } = gate;

    const { data: row, error: rowError } = await admin
      .from('freelancers')
      .select('id, freelancer_code, nama_lengkap, cv_url')
      .eq('id', id)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) return jsonError('Freelancer tidak ditemukan.', 404);

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError('Data yang dikirim tidak valid.', 400);
    }

    const cek = await periksaCv(formData.get('file'));
    if (cek.error) return jsonError(cek.error, 400);

    // Folder per Freelancer memakai Freelancer ID saja (tidak berubah walau nama
    // diedit), supaya berkas A3 (Agreement) nanti ikut satu folder yang sama.
    const driveFileName = `CV_${row.freelancer_code}_${Date.now()}.${cek.ext}`;
    let upload;
    try {
      upload = await uploadFreelancerFileToDrive(cek.buffer, driveFileName, cek.mime, row.freelancer_code);
    } catch (driveError) {
      console.error('Upload CV Freelancer ke Drive gagal:', driveError);
      return jsonError('Gagal mengupload CV ke Google Drive. Silakan coba lagi.', 500);
    }

    const cvLama = row.cv_url || null;
    const { error: updateError } = await admin
      .from('freelancers')
      .update({ cv_url: cvRefFromDriveId(upload.fileId) })
      .eq('id', id);
    if (updateError) {
      // File sudah di Drive tapi penunjuknya gagal tersimpan: file ini yatim dan
      // tidak terlihat di aplikasi. Dicatat di log server untuk dibersihkan manual.
      console.error('Simpan cv_url Freelancer gagal; file Drive yatim:', upload.fileId, updateError);
      return jsonError(
        'Gagal menyimpan CV: ' + friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Simpan CV Freelancer' }),
        500
      );
    }

    logActivity(admin, {
      userId: emp.id,
      aksi: 'upload_cv_freelancer',
      targetTable: 'freelancers',
      targetId: id,
      detail: {
        freelancer_code: row.freelancer_code,
        nama_lengkap: row.nama_lengkap,
        mengganti: !!cvLama,
        cv_baru: cvRefFromDriveId(upload.fileId),
        ...(cvLama ? { cv_sebelumnya: cvLama } : {}),
      },
    });

    return NextResponse.json({ success: true, has_cv: true }, { status: 200 });
  } catch (err) {
    console.error('POST /api/freelancers/[id]/cv error:', err);
    return jsonError('Terjadi kesalahan server.', 500);
  }
}
