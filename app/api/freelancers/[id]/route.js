import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { FREELANCER_ADMIN_COLUMNS, validateFreelancerInput, isValidFreelancerStatus } from '@/lib/freelancerAdminConfig';
import {
  UUID_RE,
  jsonError,
  gerbangFreelancerAdmin,
  sinkronBanFreelancer,
  peringatanBan,
} from '@/lib/freelancerAdminServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';

// Bentuk baris untuk browser admin: tanpa cv_url mentah dan auth_user_id.
function untukBrowser(row) {
  const { cv_url, auth_user_id, ...rest } = row;
  return { ...rest, has_cv: !!cv_url, has_account: !!auth_user_id, agreement_status: null };
}

// GET /api/freelancers/[id] — detail data dasar (tanpa data sensitif; tampilan
// rekening/NPWP masked untuk tim dikerjakan di A4).
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(String(id || ''))) return jsonError('ID Freelancer tidak valid.', 400);

    const admin = createAdminClient();
    const gate = await gerbangFreelancerAdmin(admin);
    if (gate.error) return jsonError(gate.error, gate.status);

    const { data: row, error } = await admin
      .from('freelancers')
      .select(FREELANCER_ADMIN_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      return jsonError(friendlyError(error, 'Gagal memuat data Freelancer.', { context: 'Muat detail Freelancer' }), 500);
    }
    if (!row) return jsonError('Freelancer tidak ditemukan.', 404);

    return NextResponse.json({ freelancer: untukBrowser(row) }, { status: 200 });
  } catch (err) {
    console.error('GET /api/freelancers/[id] error:', err);
    return jsonError('Terjadi kesalahan server.', 500);
  }
}

// PATCH /api/freelancers/[id]
// Ubah data dasar dan/atau status akun. Body JSON:
//   { nama_lengkap, no_whatsapp, alamat, tanggal_bergabung, status }
// Email TIDAK bisa diubah di sini (identitas login). Freelancer ID tidak pernah
// berubah. Data sensitif (rekening, NPWP/NIK) bukan bagian dari route ini.
// Perubahan status disamakan dengan Supabase Auth (inactive/suspended = diblokir).
// Akun dan data tidak pernah dihapus.
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

    const { error: validationError, values } = validateFreelancerInput(body, { mode: 'update' });
    if (validationError) return jsonError(validationError, 400);
    if (!isValidFreelancerStatus(body?.status)) return jsonError('Status akun tidak valid.', 400);
    const nextStatus = body.status;

    const { data: before, error: beforeError } = await admin
      .from('freelancers')
      .select('id, freelancer_code, nama_lengkap, no_whatsapp, alamat, tanggal_bergabung, status, auth_user_id')
      .eq('id', id)
      .maybeSingle();
    if (beforeError) {
      return jsonError(friendlyError(beforeError, 'Gagal memuat data Freelancer.', { context: 'Edit Freelancer' }), 500);
    }
    if (!before) return jsonError('Freelancer tidak ditemukan.', 404);

    const next = {
      nama_lengkap: values.nama_lengkap,
      no_whatsapp: values.no_whatsapp,
      alamat: values.alamat,
      tanggal_bergabung: values.tanggal_bergabung,
      status: nextStatus,
    };

    const dataBerubah = ['nama_lengkap', 'no_whatsapp', 'alamat', 'tanggal_bergabung'].filter(
      (k) => (before[k] ?? null) !== (next[k] ?? null)
    );
    const statusBerubah = before.status !== nextStatus;

    if (dataBerubah.length === 0 && !statusBerubah) {
      const { data: same, error: sameError } = await admin
        .from('freelancers')
        .select(FREELANCER_ADMIN_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      if (sameError || !same) return jsonError('Gagal memuat data Freelancer.', 500);
      return NextResponse.json({ success: true, freelancer: untukBrowser(same), tidakBerubah: true }, { status: 200 });
    }

    const { data: updated, error: updateError } = await admin
      .from('freelancers')
      .update(next)
      .eq('id', id)
      .select(FREELANCER_ADMIN_COLUMNS)
      .maybeSingle();
    if (updateError) {
      return jsonError(
        'Gagal menyimpan perubahan: ' + friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Edit Freelancer' }),
        500
      );
    }
    if (!updated) return jsonError('Freelancer tidak ditemukan.', 404);

    // Samakan blokir login dengan status baru. Kegagalan di sini tidak
    // membatalkan perubahan yang sudah tersimpan; dikembalikan sebagai warning.
    let authBan = 'tidak_berubah';
    let warning;
    if (statusBerubah) {
      authBan = await sinkronBanFreelancer(admin, before.auth_user_id, nextStatus);
      warning = peringatanBan(authBan, nextStatus) || undefined;
    }

    // Fire-and-forget — gagal mencatat log tidak boleh membatalkan perubahan.
    if (dataBerubah.length > 0) {
      logActivity(admin, {
        userId: emp.id,
        aksi: 'ubah_freelancer',
        targetTable: 'freelancers',
        targetId: id,
        detail: {
          freelancer_code: before.freelancer_code,
          sebelum: Object.fromEntries(dataBerubah.map((k) => [k, before[k] ?? null])),
          sesudah: Object.fromEntries(dataBerubah.map((k) => [k, next[k] ?? null])),
        },
      });
    }
    if (statusBerubah) {
      logActivity(admin, {
        userId: emp.id,
        aksi: 'ubah_status_freelancer',
        targetTable: 'freelancers',
        targetId: id,
        detail: {
          freelancer_code: before.freelancer_code,
          nama_lengkap: updated.nama_lengkap,
          sebelum: { status: before.status },
          sesudah: { status: nextStatus },
          auth_ban: authBan,
        },
      });
    }

    return NextResponse.json(
      { success: true, freelancer: untukBrowser(updated), ...(warning ? { warning } : {}) },
      { status: 200 }
    );
  } catch (err) {
    console.error('PATCH /api/freelancers/[id] error:', err);
    return jsonError('Terjadi kesalahan server.', 500);
  }
}
