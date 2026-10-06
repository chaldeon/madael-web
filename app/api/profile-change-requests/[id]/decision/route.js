import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployee } from '@/lib/notify';
import { PROFILE_EDITABLE_FIELDS, fieldLabel, isAllowedProfileField } from '@/lib/profileFields';

// POST /api/profile-change-requests/[id]/decision   body: { decision, catatan? }
//   'approved' : pending -> approved, field_changes diterapkan ke employees_master
//   'rejected' : pending -> rejected
//
// Dulu approve dilakukan dari browser: SEMUA key di field_changes (JSON bebas
// kiriman karyawan) langsung di-update ke employees_master milik master_id
// yang juga kiriman karyawan. Di sini yang diterapkan hanya key whitelist
// (PROFILE_EDITABLE_FIELDS), baris master diturunkan dari pemohon di server
// (linked_employee_id), dan statusnya diklaim lebih dulu lewat
// compare-and-swap supaya dua admin tidak bisa memproses request yang sama.

const SELECT_REQUEST = '*, employees:employee_id ( nama, employee_id )';
const MAKS_ALAMAT = 500;
const MAKS_DEFAULT = 150;
const MAKS_CATATAN = 500;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Validasi + normalisasi satu nilai `after`. Return { value } atau { error }.
function bersihkanNilai(key, after) {
  if (after !== null && typeof after !== 'string') {
    return { error: `Nilai "${fieldLabel(key)}" tidak valid.` };
  }
  const nilai = after === null ? null : after.trim() || null;
  if (nilai === null) return { value: null };

  const maks = key === 'alamat' ? MAKS_ALAMAT : MAKS_DEFAULT;
  if (nilai.length > maks) {
    return { error: `"${fieldLabel(key)}" maksimal ${maks} karakter.` };
  }

  // Field select (mis. npwp_status): hanya nilai yang ada di opsi form.
  // Opsi '' berarti "belum diisi", sudah dinormalisasi jadi null di atas.
  const options = PROFILE_EDITABLE_FIELDS.find((f) => f.key === key)?.options;
  if (options && !options.some((o) => o.value === nilai)) {
    return { error: `Nilai "${fieldLabel(key)}" tidak termasuk pilihan yang diizinkan.` };
  }
  return { value: nilai };
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['profile_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => ({}));
    const decision = body?.decision;
    if (!['approved', 'rejected'].includes(decision)) {
      return NextResponse.json({ error: 'Keputusan tidak valid.' }, { status: 400 });
    }

    const catatanMentah = body?.catatan;
    if (catatanMentah !== undefined && catatanMentah !== null && typeof catatanMentah !== 'string') {
      return NextResponse.json({ error: 'Catatan tidak valid.' }, { status: 400 });
    }
    const catatan = (catatanMentah || '').trim() || null;
    if (catatan && catatan.length > MAKS_CATATAN) {
      return NextResponse.json({ error: `Catatan maksimal ${MAKS_CATATAN} karakter.` }, { status: 400 });
    }

    const { data: row, error: rowError } = await admin
      .from('profile_change_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (rowError) {
      // 22P02 = id bukan format yang valid untuk kolom id
      if (rowError.code === '22P02') {
        return NextResponse.json({ error: 'Pengajuan tidak ditemukan.' }, { status: 404 });
      }
      console.error('Muat pengajuan profil error:', rowError);
      return NextResponse.json({ error: 'Gagal memuat pengajuan. Coba lagi.' }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: 'Pengajuan tidak ditemukan.' }, { status: 404 });
    }

    if (row.status !== 'pending') {
      return NextResponse.json(
        { error: 'Pengajuan ini sudah diproses. Daftar dimuat ulang.', status: row.status },
        { status: 409 }
      );
    }

    // Tidak ada approve/reject untuk pengajuan milik sendiri (Keputusan Default 1:
    // berlaku juga untuk superadmin).
    if (row.employee_id === emp.id) {
      return NextResponse.json(
        { error: 'Anda tidak bisa memproses pengajuan perubahan profil milik sendiri.' },
        { status: 403 }
      );
    }

    const fieldChanges = isPlainObject(row.field_changes) ? row.field_changes : {};
    const keys = Object.keys(fieldChanges);

    // Hanya dipakai saat approve: data yang sudah difilter + baris master tujuan.
    let updates = null;
    let master = null;

    if (decision === 'approved') {
      if (keys.length === 0) {
        return NextResponse.json(
          { error: 'Pengajuan ini tidak memuat perubahan yang bisa diterapkan. Silakan tolak.' },
          { status: 400 }
        );
      }

      const tidakDiizinkan = keys.filter((k) => !isAllowedProfileField(k));
      if (tidakDiizinkan.length > 0) {
        return NextResponse.json(
          {
            error: `Pengajuan memuat field yang tidak diizinkan (${tidakDiizinkan.join(', ')}), jadi tidak bisa disetujui. Silakan tolak.`,
            tidak_diizinkan: tidakDiizinkan,
          },
          { status: 400 }
        );
      }

      updates = {};
      for (const key of keys) {
        const change = fieldChanges[key];
        const hasil = bersihkanNilai(key, isPlainObject(change) ? change.after : undefined);
        if (hasil.error) {
          return NextResponse.json({ error: hasil.error }, { status: 400 });
        }
        updates[key] = hasil.value;
      }

      // Baris master diturunkan dari pemohon, bukan dari row.master_id
      // (kolom itu diisi browser karyawan).
      const { data: masterRow, error: masterLookupError } = await admin
        .from('employees_master')
        .select('id')
        .eq('linked_employee_id', row.employee_id)
        .maybeSingle();
      if (masterLookupError) {
        console.error('Cari data master pemohon error:', masterLookupError);
        return NextResponse.json({ error: 'Gagal memuat data master karyawan. Coba lagi.' }, { status: 500 });
      }
      if (!masterRow) {
        return NextResponse.json(
          { error: 'Karyawan ini belum terhubung ke data master (Payroll), jadi perubahan belum bisa diterapkan.' },
          { status: 409 }
        );
      }
      if (row.master_id && row.master_id !== masterRow.id) {
        console.error('Pengajuan profil ditolak: master_id tidak cocok dengan master pemohon', {
          request_id: row.id,
          employee_id: row.employee_id,
          master_id_pengajuan: row.master_id,
          master_id_pemohon: masterRow.id,
        });
        return NextResponse.json(
          { error: 'Data master pada pengajuan ini tidak cocok dengan data master pemohon, jadi tidak bisa disetujui. Silakan tolak.' },
          { status: 409 }
        );
      }
      master = masterRow;
    }

    // (a) Klaim request: update bersyarat status = 'pending'. Kalau kosong,
    // berarti sudah diproses pihak lain.
    const { data: diklaim, error: claimError } = await admin
      .from('profile_change_requests')
      .update({
        status: decision,
        catatan_reviewer: catatan,
        reviewed_by: emp.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select(SELECT_REQUEST)
      .maybeSingle();
    if (claimError) {
      console.error('Klaim pengajuan profil error:', claimError);
      return NextResponse.json({ error: 'Gagal memperbarui status pengajuan. Coba lagi.' }, { status: 500 });
    }
    if (!diklaim) {
      return NextResponse.json(
        { error: 'Pengajuan ini baru saja diproses pihak lain. Daftar dimuat ulang.' },
        { status: 409 }
      );
    }

    // (b) Terapkan ke employees_master (hanya approve).
    if (decision === 'approved') {
      const { data: terupdate, error: masterError } = await admin
        .from('employees_master')
        .update(updates)
        .eq('id', master.id)
        .select('id');

      if (masterError || !terupdate || terupdate.length !== 1) {
        console.error('Terapkan perubahan profil ke master error:', masterError || 'tidak ada baris yang terupdate', {
          request_id: row.id,
          master_id: master.id,
        });

        // (c) Kembalikan request ke pending supaya tidak "disetujui" padahal
        // datanya belum berubah.
        const { error: rollbackError } = await admin
          .from('profile_change_requests')
          .update({ status: 'pending', catatan_reviewer: null, reviewed_by: null, reviewed_at: null })
          .eq('id', id)
          .eq('status', 'approved')
          .eq('reviewed_by', emp.id);
        if (rollbackError) {
          console.error('Kembalikan pengajuan profil ke pending gagal:', rollbackError, { request_id: row.id });
          return NextResponse.json(
            { error: 'Perubahan gagal diterapkan dan status pengajuan belum bisa dikembalikan. Mohon periksa pengajuan ini dan hubungi superadmin.' },
            { status: 500 }
          );
        }
        return NextResponse.json(
          { error: 'Gagal menerapkan perubahan ke data master. Pengajuan tetap menunggu, silakan coba lagi.' },
          { status: 500 }
        );
      }
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: `${decision === 'approved' ? 'approve' : 'reject'}_profil`,
      targetTable: 'profile_change_requests',
      targetId: row.id,
      detail: { employee_id: row.employee_id, field_changes: row.field_changes, catatan_reviewer: catatan },
    });

    const label = decision === 'approved' ? 'disetujui' : 'ditolak';
    const fieldsLabel = keys.map(fieldLabel).join(', ');
    await notifyEmployee(admin, {
      userId: row.employee_id,
      tipe: `profil_${decision}`,
      pesan: `Pengajuan perubahan profil kamu${fieldsLabel ? ` (${fieldsLabel})` : ''} telah ${label}.${catatan ? ' Catatan: ' + catatan : ''}`,
      link: '/employee/profile',
    });

    return NextResponse.json({ success: true, request: diklaim });
  } catch (err) {
    console.error('Proses pengajuan profil error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
