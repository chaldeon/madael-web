import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { uploadFreelancerFileToDrive } from '@/lib/googleDrive';
import { requireFreelancerModule } from '@/lib/freelancerAccessServer';
import { jsonError, periksaAgreement } from '@/lib/freelancerAdminServer';
import {
  AGREEMENT_STATUS,
  agreementRefFromDriveId,
  bolehUnggahBertandaTangan,
  pesanTidakBolehUnggahBertandaTangan,
} from '@/lib/freelancerAgreementConfig';
import { friendlyError } from '@/lib/errorMessage';

// Route self-service Freelancer untuk Agreement miliknya sendiri (FRE-TOOL-04).
// Padanan sisi Freelancer dari /api/freelancers/[id]/agreement (sisi Tim).
//
// Pengaman:
// - Id Freelancer HANYA dari sesi (requireFreelancerModule); tidak ada parameter id
//   dari klien, jadi Freelancer A tidak punya jalan menyentuh Agreement Freelancer B.
// - Akun karyawan dan akun Freelancer non-active ditolak di gerbang (403).
// - Profil Saya tidak gated (modul `freelancer_profile`): Freelancer harus bisa
//   menandatangani Agreement SEBELUM gate (FRE-TOOL-07) terbuka.
// - Penunjuk file Drive (`*_doc_ref`) tidak pernah dikirim ke browser.
const MODUL_AGREEMENT = ['freelancer_profile'];

const AGREEMENT_COLUMNS =
  'id, freelancer_id, original_doc_ref, signed_doc_ref, status, rejection_reason, uploaded_at, verified_at, updated_at';

// Bentuk untuk browser Freelancer (sama dengan sisi Tim + penanda boleh-unggah dari
// aturan bersama). `row` null = belum ada baris = belum tersedia.
function untukBrowser(row) {
  const status = row?.status || AGREEMENT_STATUS.BELUM_TERSEDIA;
  return {
    status,
    has_original: !!row?.original_doc_ref,
    has_signed: !!row?.signed_doc_ref,
    rejection_reason: row?.rejection_reason ?? null,
    uploaded_at: row?.uploaded_at ?? null,
    verified_at: row?.verified_at ?? null,
    updated_at: row?.updated_at ?? null,
    can_upload_signed: bolehUnggahBertandaTangan(status),
  };
}

async function muatAgreementSendiri(admin, freelancerId) {
  return admin.from('freelancer_agreements').select(AGREEMENT_COLUMNS).eq('freelancer_id', freelancerId).maybeSingle();
}

// GET /api/freelancer/me/agreement — status + metadata Agreement milik sendiri.
// Dokumen aslinya dibuka lewat GET /api/freelancer/me/agreement/asli.
export async function GET() {
  try {
    const admin = createAdminClient();
    const gate = await requireFreelancerModule(admin, MODUL_AGREEMENT);
    if (gate.error) return jsonError(gate.error, gate.status);
    const { freelancer } = gate;

    const { data: row, error } = await muatAgreementSendiri(admin, freelancer.id);
    if (error) {
      return jsonError(friendlyError(error, 'Gagal memuat Agreement.', { context: 'Muat Agreement Saya' }), 500);
    }

    return NextResponse.json({ agreement: untukBrowser(row) }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('GET /api/freelancer/me/agreement error:', err);
    return jsonError('Terjadi kesalahan server.', 500);
  }
}

// POST /api/freelancer/me/agreement — Freelancer mengunggah dokumen Agreement yang
// sudah ditandatangani. FormData: file (PDF/JPG/PNG, maks 4MB; isi diperiksa dari
// byte awal — aturan sama dengan unggahan Tim, asumsi FRE-Q-16). Hanya sah saat status
// "menunggu_tanda_tangan" atau "ditolak"; hasilnya "menunggu_verifikasi". Setelah
// ditolak, unggah ulang mengosongkan sisa keputusan lama (alasan, verifikator, waktu).
// File lama TIDAK dihapus dari Drive (pola CV/Agreement Tim): hanya penunjuk yang
// berganti. Tidak memakai logActivity (FRE-TOOL-27): jejak ada di baris Agreement
// (uploaded_by_freelancer_id, uploaded_at, status).
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const gate = await requireFreelancerModule(admin, MODUL_AGREEMENT);
    if (gate.error) return jsonError(gate.error, gate.status);
    const { freelancer } = gate;

    const { data: existing, error: existingError } = await muatAgreementSendiri(admin, freelancer.id);
    if (existingError) {
      return jsonError(friendlyError(existingError, 'Gagal memuat Agreement.', { context: 'Unggah Agreement Saya' }), 500);
    }

    // Status dicek SEBELUM unggah ke Drive supaya penolakan tidak meninggalkan file yatim.
    const statusSekarang = existing?.status || AGREEMENT_STATUS.BELUM_TERSEDIA;
    if (!bolehUnggahBertandaTangan(statusSekarang)) {
      return jsonError(pesanTidakBolehUnggahBertandaTangan(statusSekarang), 409);
    }
    // Pengaman data: status sah tetapi dokumen asli tidak ada = baris tidak wajar.
    if (!existing?.original_doc_ref) {
      return jsonError('Dokumen Agreement kamu belum tersedia. Silakan hubungi Tim Internal Madael.', 409);
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError('Data yang dikirim tidak valid.', 400);
    }

    const cek = await periksaAgreement(formData.get('file'));
    if (cek.error) return jsonError(cek.error, 400);

    // Folder Drive sama dengan CV dan dokumen asli (Freelancer ID saja, FRE-Q-23).
    const driveFileName = `Agreement_${freelancer.freelancer_code}_bertanda-tangan_${Date.now()}.${cek.ext}`;
    let upload;
    try {
      upload = await uploadFreelancerFileToDrive(cek.buffer, driveFileName, cek.mime, freelancer.freelancer_code);
    } catch (driveError) {
      console.error('Upload Agreement bertanda tangan Freelancer ke Drive gagal:', driveError);
      return jsonError('Gagal mengupload dokumen ke Google Drive. Silakan coba lagi.', 500);
    }

    const sekarang = new Date().toISOString();
    // Pengunggah: isi SATU kolom saja (CHECK freelancer_agreements_uploader_check);
    // Freelancer = uploaded_by_freelancer_id, kolom Tim dikosongkan. Sisa keputusan
    // penolakan sebelumnya dikosongkan agar status baru tidak membawa data lama.
    // Syarat `status` yang sama dengan saat dibaca: bila Tim mengubahnya di sela-sela,
    // update tidak menimpa dan Freelancer diminta memuat ulang.
    const { data: saved, error } = await admin
      .from('freelancer_agreements')
      .update({
        signed_doc_ref: agreementRefFromDriveId(upload.fileId),
        status: AGREEMENT_STATUS.MENUNGGU_VERIFIKASI,
        rejection_reason: null,
        verified_by: null,
        verified_at: null,
        uploaded_by_freelancer_id: freelancer.id,
        uploaded_by_employee_id: null,
        uploaded_at: sekarang,
        updated_at: sekarang,
      })
      .eq('id', existing.id)
      .eq('freelancer_id', freelancer.id)
      .eq('status', existing.status)
      .select(AGREEMENT_COLUMNS)
      .maybeSingle();
    if (error) {
      console.error('Simpan Agreement bertanda tangan gagal; file Drive yatim:', upload.fileId, error);
      return jsonError(
        'Gagal menyimpan dokumen: ' + friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Simpan Agreement Saya' }),
        500
      );
    }
    if (!saved) {
      console.error('Agreement berubah saat diunggah; file Drive yatim:', upload.fileId);
      return jsonError('Status Agreement kamu baru saja berubah. Muat ulang halaman lalu coba lagi.', 409);
    }

    return NextResponse.json({ success: true, agreement: untukBrowser(saved) }, { status: 200 });
  } catch (err) {
    console.error('POST /api/freelancer/me/agreement error:', err);
    return jsonError('Terjadi kesalahan server.', 500);
  }
}
