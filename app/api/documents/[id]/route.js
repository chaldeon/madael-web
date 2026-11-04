import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { muatDokumenUntukKelola } from '@/lib/documentAccessServer';
import { validateDokumenEdit } from '@/lib/documentServer';

// PATCH /api/documents/[id]
//   body: { judul, content, tanggal_dokumen, client_id?, catatan? }
//
// Simpan hasil edit dokumen dari halaman Edit Dokumen. Dulu browser meng-update
// tabel documents langsung: tanpa validasi di server dan tanpa jejak siapa
// mengubah isi dokumen.
//
// Yang boleh diubah hanya judul, klien, isi, catatan, dan tanggal dokumen —
// nomor surat, jenis, pembuat, dan status tidak (status lewat /status).
// Hak sama dengan sebelumnya (superadmin, pembuat, atau document_manage).
// Dokumen berstatus Ditandatangani tetap bisa diedit seperti sebelumnya,
// tetapi log mencatat status saat diedit dan field yang berubah.
const FIELD_DIPANTAU = ['judul', 'client_id', 'catatan', 'tanggal_dokumen'];

// Urutan key jsonb dari Postgres tidak sama dengan urutan key dari browser,
// jadi dibandingkan dengan key yang diurutkan supaya tidak salah mengira
// "isi berubah".
function stabil(value) {
  if (Array.isArray(value)) return value.map(stabil);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stabil(value[k])]));
  }
  return value ?? null;
}

function samaNilai(a, b) {
  return JSON.stringify(stabil(a)) === JSON.stringify(stabil(b));
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const gate = await muatDokumenUntukKelola(
      admin,
      id,
      'id, nomor_surat, kode_jenis, judul, client_id, catatan, tanggal_dokumen, content, status, created_by'
    );
    if (gate.error) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
    const { emp, doc } = gate;

    const body = await request.json().catch(() => null);
    const { values, error: validationError } = validateDokumenEdit(body);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    if (values.client_id) {
      const { data: client, error: clientError } = await admin
        .from('companies')
        .select('id')
        .eq('id', values.client_id)
        .maybeSingle();
      if (clientError && clientError.code !== '22P02') {
        return NextResponse.json(
          { error: `Gagal memeriksa klien: ${friendlyError(clientError, 'terjadi kesalahan pada server.', { context: 'Cek klien edit dokumen' })}` },
          { status: 500 }
        );
      }
      if (clientError || !client) {
        return NextResponse.json({ error: 'Klien tidak ditemukan.' }, { status: 400 });
      }
    }

    const { error: updateError } = await admin
      .from('documents')
      .update({
        judul: values.judul,
        client_id: values.client_id,
        content: values.content,
        catatan: values.catatan,
        tanggal_dokumen: values.tanggal_dokumen,
      })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json(
        { error: `Gagal memperbarui dokumen: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Edit dokumen' })}` },
        { status: 500 }
      );
    }

    const tanggalSebelum = doc.tanggal_dokumen ? String(doc.tanggal_dokumen).slice(0, 10) : null;
    const sebelum = { judul: doc.judul, client_id: doc.client_id, catatan: doc.catatan, tanggal_dokumen: tanggalSebelum };
    const berubah = {};
    for (const f of FIELD_DIPANTAU) {
      if (!samaNilai(sebelum[f], values[f])) {
        berubah[f] = { sebelum: sebelum[f] ?? null, sesudah: values[f] ?? null };
      }
    }
    // Isi dokumen bisa besar: cukup dicatat berubah atau tidak.
    const isiBerubah = !samaNilai(doc.content, values.content);

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_dokumen',
      targetTable: 'documents',
      targetId: id,
      detail: {
        nomor_surat: doc.nomor_surat,
        kode_jenis: doc.kode_jenis,
        status_saat_diedit: doc.status,
        isi_berubah: isiBerubah,
        field_berubah: berubah,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Edit dokumen error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
