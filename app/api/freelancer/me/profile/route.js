import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireFreelancerModule } from '@/lib/freelancerAccessServer';
import { jsonError } from '@/lib/freelancerAdminServer';
import {
  PROFILE_ACCOUNT_FIELDS,
  PROFILE_ACCOUNT_COLUMNS,
  PROFILE_PAYMENT_FIELDS,
  PROFILE_PAYMENT_COLUMNS,
  kolomProfilKosong,
  validatePaymentInput,
  pesanGalatProfil,
  ringkasGalat,
} from '@/lib/freelancerProfile';

// Route self-service Freelancer untuk Profil Saya (FRE-TOOL-05).
//
// Pengaman:
// - Id Freelancer HANYA dari sesi (requireFreelancerModule); tidak ada parameter id
//   dari klien, jadi hanya data milik sendiri yang terbaca/berubah.
// - Akun karyawan dan akun Freelancer non-active ditolak di gerbang (403).
// - Profil Saya tidak gated (modul `freelancer_profile`): profil harus bisa dilengkapi
//   SEBELUM gate akses (FRE-TOOL-07) terbuka.
// - Data akun read-only; PATCH hanya menerima empat kolom pembayaran.
// - Nilai sensitif (rekening, NPWP/NIK) tidak masuk log maupun pesan error: error
//   database lewat pesanGalatProfil, exception tak terduga hanya dicatat name/code,
//   dan body request tidak pernah dicatat.
// - Respons memakai Cache-Control private, no-store.
const MODUL_PROFIL = ['freelancer_profile'];
const SELECT_PROFIL = `${PROFILE_ACCOUNT_COLUMNS}, ${PROFILE_PAYMENT_COLUMNS}`;
const HEADER_PRIBADI = { 'Cache-Control': 'private, no-store' };

function ambil(row, fields) {
  return Object.fromEntries(fields.map((key) => [key, row?.[key] ?? null]));
}

// Bentuk untuk browser Freelancer pemilik akun. Dipilih eksplisit per kolom (bukan
// menyebar baris) supaya kolom lain tidak ikut terkirim.
function untukBrowser(row) {
  const kosong = kolomProfilKosong(row);
  return {
    account: ambil(row, PROFILE_ACCOUNT_FIELDS),
    payment: ambil(row, PROFILE_PAYMENT_FIELDS),
    profile_complete: kosong.length === 0,
    missing_fields: kosong,
  };
}

// GET /api/freelancer/me/profile — data akun (read-only), data pembayaran milik
// sendiri, dan penanda kelengkapan profil.
export async function GET() {
  try {
    const admin = createAdminClient();
    const gate = await requireFreelancerModule(admin, MODUL_PROFIL);
    if (gate.error) return jsonError(gate.error, gate.status);
    const { freelancer } = gate;

    const { data: row, error } = await admin
      .from('freelancers')
      .select(SELECT_PROFIL)
      .eq('id', freelancer.id)
      .maybeSingle();
    if (error) {
      return jsonError(pesanGalatProfil(error, 'Gagal memuat profil.', 'Muat Profil Saya'), 500);
    }
    if (!row) return jsonError('Data Freelancer tidak ditemukan.', 404);

    return NextResponse.json({ profile: untukBrowser(row) }, { status: 200, headers: HEADER_PRIBADI });
  } catch (err) {
    console.error('GET /api/freelancer/me/profile error:', ringkasGalat(err));
    return jsonError('Terjadi kesalahan server.', 500);
  }
}

// PATCH /api/freelancer/me/profile — Freelancer mengisi/mengubah data pembayaran.
// Body JSON: subset dari { nama_bank, nomor_rekening, nama_pemilik_rekening, npwp_nik }.
// Kolom yang tidak dikirim tidak diubah; teks kosong mengosongkan kolom itu (profil
// kembali "belum lengkap"). Kolom lain (data akun dan sebagainya) ditolak 400.
// Nomor rekening dan NPWP/NIK disimpan sebagai angka saja. Tanpa logActivity
// (FRE-TOOL-27) dan tanpa menulis nilai ke log.
export async function PATCH(request) {
  try {
    const admin = createAdminClient();
    const gate = await requireFreelancerModule(admin, MODUL_PROFIL);
    if (gate.error) return jsonError(gate.error, gate.status);
    const { freelancer } = gate;

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError('Data yang dikirim tidak valid.', 400);
    }
    const { error: validationError, values } = validatePaymentInput(body);
    if (validationError) return jsonError(validationError, 400);

    const { data: before, error: beforeError } = await admin
      .from('freelancers')
      .select(SELECT_PROFIL)
      .eq('id', freelancer.id)
      .maybeSingle();
    if (beforeError) {
      return jsonError(pesanGalatProfil(beforeError, 'Gagal memuat profil.', 'Ubah Profil Saya (muat)'), 500);
    }
    if (!before) return jsonError('Data Freelancer tidak ditemukan.', 404);

    const berubah = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => (before[key] ?? null) !== (value ?? null))
    );
    if (Object.keys(berubah).length === 0) {
      return NextResponse.json(
        { success: true, profile: untukBrowser(before), tidakBerubah: true },
        { status: 200, headers: HEADER_PRIBADI }
      );
    }

    const { data: updated, error } = await admin
      .from('freelancers')
      .update(berubah)
      .eq('id', freelancer.id)
      .select(SELECT_PROFIL)
      .maybeSingle();
    if (error) {
      return jsonError(
        'Gagal menyimpan data pembayaran: ' + pesanGalatProfil(error, 'terjadi kesalahan pada server.', 'Simpan Profil Saya'),
        500
      );
    }
    if (!updated) return jsonError('Data Freelancer tidak ditemukan.', 404);

    return NextResponse.json({ success: true, profile: untukBrowser(updated) }, { status: 200, headers: HEADER_PRIBADI });
  } catch (err) {
    console.error('PATCH /api/freelancer/me/profile error:', ringkasGalat(err));
    return jsonError('Terjadi kesalahan server.', 500);
  }
}
