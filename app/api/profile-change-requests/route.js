import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { notifyByModule } from '@/lib/notify';
import { friendlyError } from '@/lib/errorMessage';
import {
  PROFILE_EDITABLE_FIELDS, fieldLabel, isAllowedProfileField,
  bersihkanNilaiProfil, MAKS_CATATAN_KARYAWAN_PROFIL,
} from '@/lib/profileFields';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const KOLOM_MASTER = ['id', ...PROFILE_EDITABLE_FIELDS.map((f) => f.key)].join(', ');

// POST /api/profile-change-requests   body: { changes: { <key>: <nilai baru> }, catatan? }
// Karyawan mengajukan perubahan data pribadinya (alamat, kontak darurat,
// rekening, NPWP, BPJS) untuk disetujui superadmin. Dulu baris pengajuan
// di-INSERT langsung dari browser, termasuk master_id dan before/after yang
// dikirim klien. Sekarang:
// - baris employees_master diturunkan dari sesi (linked_employee_id), bukan
//   dari body
// - hanya key whitelist (PROFILE_EDITABLE_FIELDS) yang diterima; key lain
//   ditolak, bukan diam-diam dibuang
// - nilai `before` dibaca dari database; field yang nilainya tidak berubah
//   dibuang, dan pengajuan tanpa perubahan sama sekali ditolak
// - panjang & opsi select divalidasi dengan aturan yang sama seperti saat approve
// Body hanya membawa nilai baru; klien tidak bisa menentukan `before`.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['profile']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => null);
    if (!isPlainObject(body) || !isPlainObject(body.changes)) {
      return NextResponse.json({ error: 'Data permintaan tidak valid.' }, { status: 400 });
    }

    const catatanMentah = body.catatan;
    if (catatanMentah !== undefined && catatanMentah !== null && typeof catatanMentah !== 'string') {
      return NextResponse.json({ error: 'Catatan tidak valid.' }, { status: 400 });
    }
    const catatan = (catatanMentah || '').trim() || null;
    if (catatan && catatan.length > MAKS_CATATAN_KARYAWAN_PROFIL) {
      return NextResponse.json({ error: `Catatan maksimal ${MAKS_CATATAN_KARYAWAN_PROFIL} karakter.` }, { status: 400 });
    }

    const keys = Object.keys(body.changes);
    if (keys.length === 0) {
      return NextResponse.json({ error: 'Tidak ada perubahan untuk diajukan.' }, { status: 400 });
    }
    const tidakBoleh = keys.find((k) => !isAllowedProfileField(k));
    if (tidakBoleh) {
      return NextResponse.json({ error: 'Ada data yang tidak boleh diubah lewat pengajuan ini.' }, { status: 400 });
    }

    const nilaiBaru = {};
    for (const key of keys) {
      const hasil = bersihkanNilaiProfil(key, body.changes[key]);
      if (hasil.error) {
        return NextResponse.json({ error: hasil.error }, { status: 400 });
      }
      nilaiBaru[key] = hasil.value;
    }

    const { data: master, error: masterError } = await admin
      .from('employees_master')
      .select(KOLOM_MASTER)
      .eq('linked_employee_id', emp.id)
      .maybeSingle();
    if (masterError) {
      console.error('Ajukan perubahan profil — baca master error:', masterError);
      return NextResponse.json(
        { error: `Gagal memuat data karyawan: ${friendlyError(masterError, 'terjadi kesalahan pada server.', { context: 'Muat data master untuk pengajuan profil' })}` },
        { status: 500 }
      );
    }
    if (!master) {
      return NextResponse.json({ error: 'Akunmu belum terhubung ke data master karyawan.' }, { status: 400 });
    }

    // before dari database; buang field yang tidak berubah.
    const fieldChanges = {};
    for (const key of keys) {
      const before = (master[key] ?? '').toString().trim() || null;
      if (nilaiBaru[key] !== before) {
        fieldChanges[key] = { before, after: nilaiBaru[key] };
      }
    }
    if (Object.keys(fieldChanges).length === 0) {
      return NextResponse.json({ error: 'Tidak ada perubahan untuk diajukan.' }, { status: 400 });
    }

    const { data, error: insertError } = await admin
      .from('profile_change_requests')
      .insert([{
        employee_id: emp.id,
        master_id: master.id,
        field_changes: fieldChanges,
        catatan_karyawan: catatan,
        status: 'pending',
      }])
      .select()
      .single();
    if (insertError) {
      console.error('Ajukan perubahan profil error:', insertError);
      return NextResponse.json(
        { error: `Gagal mengirim pengajuan: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Kirim pengajuan perubahan profil' })}` },
        { status: 500 }
      );
    }

    await notifyByModule(admin, {
      moduleKey: 'profile_admin',
      tipe: 'profil_diajukan',
      pesan: `${emp.nama || 'Karyawan'} mengajukan perubahan profil (${Object.keys(fieldChanges).map(fieldLabel).join(', ')}).`,
      link: '/employee/profile/admin',
    });

    return NextResponse.json({ success: true, request: data }, { status: 201 });
  } catch (err) {
    console.error('Ajukan perubahan profil error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
