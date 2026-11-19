import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { uploadFreelancerFileToDrive } from '@/lib/googleDrive';
import {
  UUID_RE,
  jsonError,
  gerbangFreelancerAdmin,
  periksaAgreement,
} from '@/lib/freelancerAdminServer';
import {
  AGREEMENT_STATUS,
  agreementRefFromDriveId,
  bolehGantiDokumenAsli,
  bolehDiputuskan,
  pesanTidakBolehGantiAsli,
  pesanTidakBolehDiputuskan,
  validateKeputusanAgreement,
} from '@/lib/freelancerAgreementConfig';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';

// Kolom baris Agreement yang dibaca server. Penunjuk file (`*_doc_ref` = id Drive)
// dipakai di server saja dan TIDAK dikirim ke browser (lihat untukBrowser).
const AGREEMENT_COLUMNS =
  'id, freelancer_id, original_doc_ref, signed_doc_ref, status, rejection_reason, uploaded_at, verified_at, updated_at';

// Bentuk untuk browser admin. `row` null = belum ada baris = belum tersedia.
function untukBrowser(row) {
  return {
    status: row?.status || AGREEMENT_STATUS.BELUM_TERSEDIA,
    has_original: !!row?.original_doc_ref,
    has_signed: !!row?.signed_doc_ref,
    rejection_reason: row?.rejection_reason ?? null,
    uploaded_at: row?.uploaded_at ?? null,
    verified_at: row?.verified_at ?? null,
    updated_at: row?.updated_at ?? null,
  };
}

async function muatFreelancer(admin, id) {
  return admin.from('freelancers').select('id, freelancer_code, nama_lengkap').eq('id', id).maybeSingle();
}

async function muatAgreement(admin, freelancerId) {
  return admin.from('freelancer_agreements').select(AGREEMENT_COLUMNS).eq('freelancer_id', freelancerId).maybeSingle();
}

// GET /api/freelancers/[id]/agreement — status + metadata Agreement. Tanpa baris =
// status "belum_tersedia". Dokumennya dibuka lewat .../agreement/asli dan
// .../agreement/bertanda-tangan.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(String(id || ''))) return jsonError('ID Freelancer tidak valid.', 400);

    const admin = createAdminClient();
    const gate = await gerbangFreelancerAdmin(admin);
    if (gate.error) return jsonError(gate.error, gate.status);

    const { data: fl, error: flError } = await muatFreelancer(admin, id);
    if (flError) {
      return jsonError(friendlyError(flError, 'Gagal memuat data Freelancer.', { context: 'Muat Agreement' }), 500);
    }
    if (!fl) return jsonError('Freelancer tidak ditemukan.', 404);

    const { data: row, error } = await muatAgreement(admin, id);
    if (error) {
      return jsonError(friendlyError(error, 'Gagal memuat Agreement.', { context: 'Muat Agreement Freelancer' }), 500);
    }

    return NextResponse.json({ agreement: untukBrowser(row) }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('GET /api/freelancers/[id]/agreement error:', err);
    return jsonError('Terjadi kesalahan server.', 500);
  }
}

// POST /api/freelancers/[id]/agreement — Tim mengunggah (atau mengganti) dokumen
// Agreement asli. FormData: file (PDF/JPG/PNG, maks 4MB; isi diperiksa dari byte awal).
// Hasil: status "menunggu_tanda_tangan". Saat mengganti, dokumen bertanda tangan
// lama (bila ada, yaitu setelah ditolak) dilepas karena itu tanda tangan untuk
// dokumen yang lama. File lama TIDAK dihapus dari Drive (pola CV): hanya penunjuk
// yang berganti, dan id file lama dicatat di activity log.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(String(id || ''))) return jsonError('ID Freelancer tidak valid.', 400);

    const admin = createAdminClient();
    const gate = await gerbangFreelancerAdmin(admin);
    if (gate.error) return jsonError(gate.error, gate.status);
    const { emp } = gate;

    const { data: fl, error: flError } = await muatFreelancer(admin, id);
    if (flError) {
      return jsonError(friendlyError(flError, 'Gagal memuat data Freelancer.', { context: 'Upload Agreement' }), 500);
    }
    if (!fl) return jsonError('Freelancer tidak ditemukan.', 404);

    const { data: existing, error: existingError } = await muatAgreement(admin, id);
    if (existingError) {
      return jsonError(friendlyError(existingError, 'Gagal memuat Agreement.', { context: 'Upload Agreement' }), 500);
    }

    // Status dicek SEBELUM unggah ke Drive supaya penolakan tidak meninggalkan file yatim.
    const statusSekarang = existing?.status || AGREEMENT_STATUS.BELUM_TERSEDIA;
    if (!bolehGantiDokumenAsli(statusSekarang)) {
      return jsonError(pesanTidakBolehGantiAsli(statusSekarang), 409);
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError('Data yang dikirim tidak valid.', 400);
    }

    const cek = await periksaAgreement(formData.get('file'));
    if (cek.error) return jsonError(cek.error, 400);

    // Folder Drive sama dengan CV (Freelancer ID saja, FRE-Q-23).
    const driveFileName = `Agreement_${fl.freelancer_code}_asli_${Date.now()}.${cek.ext}`;
    let upload;
    try {
      upload = await uploadFreelancerFileToDrive(cek.buffer, driveFileName, cek.mime, fl.freelancer_code);
    } catch (driveError) {
      console.error('Upload Agreement Freelancer ke Drive gagal:', driveError);
      return jsonError('Gagal mengupload dokumen Agreement ke Google Drive. Silakan coba lagi.', 500);
    }

    const refBaru = agreementRefFromDriveId(upload.fileId);
    const sekarang = new Date().toISOString();
    // Pengunggah: isi SATU kolom saja (CHECK tabel); Tim = uploaded_by_employee_id.
    const kolomBaru = {
      original_doc_ref: refBaru,
      signed_doc_ref: null,
      status: AGREEMENT_STATUS.MENUNGGU_TANDA_TANGAN,
      rejection_reason: null,
      uploaded_by_employee_id: emp.id,
      uploaded_by_freelancer_id: null,
      uploaded_at: sekarang,
      verified_by: null,
      verified_at: null,
      updated_at: sekarang,
    };

    let saved;
    if (!existing) {
      const { data, error } = await admin
        .from('freelancer_agreements')
        .insert({ freelancer_id: id, ...kolomBaru })
        .select(AGREEMENT_COLUMNS)
        .maybeSingle();
      if (error) {
        console.error('Simpan Agreement gagal; file Drive yatim:', upload.fileId, error);
        if (error.code === '23505') {
          return jsonError('Agreement untuk Freelancer ini baru saja dibuat. Muat ulang halaman lalu coba lagi.', 409);
        }
        return jsonError(
          'Gagal menyimpan Agreement: ' + friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Simpan Agreement Freelancer' }),
          500
        );
      }
      saved = data;
    } else {
      // Syarat `status` yang sama dengan saat dibaca: bila Freelancer/Tim lain
      // mengubahnya di sela-sela, update tidak menimpa dan pengguna diminta memuat ulang.
      const { data, error } = await admin
        .from('freelancer_agreements')
        .update(kolomBaru)
        .eq('id', existing.id)
        .eq('status', existing.status)
        .select(AGREEMENT_COLUMNS)
        .maybeSingle();
      if (error) {
        console.error('Simpan Agreement gagal; file Drive yatim:', upload.fileId, error);
        return jsonError(
          'Gagal menyimpan Agreement: ' + friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Simpan Agreement Freelancer' }),
          500
        );
      }
      if (!data) {
        console.error('Agreement berubah saat diganti; file Drive yatim:', upload.fileId);
        return jsonError('Status Agreement baru saja berubah. Muat ulang halaman lalu coba lagi.', 409);
      }
      saved = data;
    }
    if (!saved) return jsonError('Gagal menyimpan Agreement. Silakan coba lagi.', 500);

    logActivity(admin, {
      userId: emp.id,
      aksi: 'upload_agreement_freelancer',
      targetTable: 'freelancers',
      targetId: id,
      detail: {
        freelancer_code: fl.freelancer_code,
        nama_lengkap: fl.nama_lengkap,
        mengganti: !!existing,
        status_sebelumnya: statusSekarang,
        dokumen_baru: refBaru,
        ...(existing?.original_doc_ref ? { dokumen_asli_sebelumnya: existing.original_doc_ref } : {}),
        ...(existing?.signed_doc_ref ? { dokumen_bertanda_tangan_dilepas: existing.signed_doc_ref } : {}),
      },
    });

    return NextResponse.json({ success: true, agreement: untukBrowser(saved) }, { status: 200 });
  } catch (err) {
    console.error('POST /api/freelancers/[id]/agreement error:', err);
    return jsonError('Terjadi kesalahan server.', 500);
  }
}

// PATCH /api/freelancers/[id]/agreement — Tim memverifikasi atau menolak dokumen
// bertanda tangan. Body JSON: { keputusan: 'terverifikasi' | 'ditolak', alasan? }
// (alasan wajib bila ditolak). Hanya sah saat status "menunggu_verifikasi".
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(String(id || ''))) return jsonError('ID Freelancer tidak valid.', 400);

    const admin = createAdminClient();
    const gate = await gerbangFreelancerAdmin(admin);
    if (gate.error) return jsonError(gate.error, gate.status);
    const { emp } = gate;

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Data yang dikirim tidak valid.', 400);
    }
    const { error: validationError, keputusan, alasan } = validateKeputusanAgreement(body);
    if (validationError) return jsonError(validationError, 400);

    const { data: fl, error: flError } = await muatFreelancer(admin, id);
    if (flError) {
      return jsonError(friendlyError(flError, 'Gagal memuat data Freelancer.', { context: 'Verifikasi Agreement' }), 500);
    }
    if (!fl) return jsonError('Freelancer tidak ditemukan.', 404);

    const { data: existing, error: existingError } = await muatAgreement(admin, id);
    if (existingError) {
      return jsonError(friendlyError(existingError, 'Gagal memuat Agreement.', { context: 'Verifikasi Agreement' }), 500);
    }

    const statusSekarang = existing?.status || AGREEMENT_STATUS.BELUM_TERSEDIA;
    if (!bolehDiputuskan(statusSekarang)) {
      return jsonError(pesanTidakBolehDiputuskan(statusSekarang), 409);
    }
    if (!existing.signed_doc_ref) {
      return jsonError('Dokumen bertanda tangan belum ada, jadi belum bisa diverifikasi atau ditolak.', 409);
    }

    const sekarang = new Date().toISOString();
    const { data: saved, error } = await admin
      .from('freelancer_agreements')
      .update({
        status: keputusan,
        rejection_reason: keputusan === AGREEMENT_STATUS.DITOLAK ? alasan : null,
        verified_by: emp.id,
        verified_at: sekarang,
        updated_at: sekarang,
      })
      .eq('id', existing.id)
      .eq('status', AGREEMENT_STATUS.MENUNGGU_VERIFIKASI)
      .select(AGREEMENT_COLUMNS)
      .maybeSingle();
    if (error) {
      return jsonError(
        'Gagal menyimpan keputusan: ' + friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Verifikasi Agreement Freelancer' }),
        500
      );
    }
    if (!saved) {
      return jsonError('Status Agreement baru saja berubah. Muat ulang halaman lalu coba lagi.', 409);
    }

    const diverifikasi = keputusan === AGREEMENT_STATUS.TERVERIFIKASI;
    logActivity(admin, {
      userId: emp.id,
      aksi: diverifikasi ? 'verifikasi_agreement_freelancer' : 'tolak_agreement_freelancer',
      targetTable: 'freelancers',
      targetId: id,
      detail: {
        freelancer_code: fl.freelancer_code,
        nama_lengkap: fl.nama_lengkap,
        sebelum: { status: AGREEMENT_STATUS.MENUNGGU_VERIFIKASI },
        sesudah: { status: keputusan },
        ...(diverifikasi ? {} : { alasan }),
      },
    });

    return NextResponse.json({ success: true, agreement: untukBrowser(saved) }, { status: 200 });
  } catch (err) {
    console.error('PATCH /api/freelancers/[id]/agreement error:', err);
    return jsonError('Terjadi kesalahan server.', 500);
  }
}
