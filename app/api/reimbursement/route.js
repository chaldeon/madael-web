import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { notifyByModule } from '@/lib/notify';
import { friendlyError } from '@/lib/errorMessage';
import { formatRupiah } from '@/lib/format';
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL } from '@/lib/uploadLimits';
import { periksaFileUpload, hashIsiFile } from '@/lib/uploadServer';
import {
  validasiKlaimReimbursement, labelKategoriReimbursement,
  BUKTI_REIMBURSEMENT_MIME, STATUS_BLOKIR_BUKTI_GANDA,
} from '@/lib/reimbursement';

const BUCKET_BUKTI = 'reimbursement-bukti';

const PESAN_BUKTI_GANDA =
  'Bukti/kuitansi ini sudah pernah dipakai untuk klaim lain yang masih berjalan atau sudah disetujui. Satu kuitansi hanya boleh dipakai satu kali.';

// POST /api/reimbursement   multipart/form-data:
//   kategori, jumlah, deskripsi, bukti (file)
// Karyawan mengajukan klaim reimbursement. Dulu bukti diupload ke storage dan
// baris klaim di-insert langsung dari browser, jadi semua aturan hanya ada di
// form (bisa dilewati). Sekarang dicek di server:
// - kategori termasuk daftar, jumlah bilangan bulat > 0 dan tidak melebihi
//   plafon per klaim kategori itu (lib/reimbursement.js)
// - deskripsi wajib, maks 500 karakter
// - bukti wajib: PDF/JPG/PNG, maks 4MB (batas body request Vercel; lihat
//   lib/uploadLimits.js), isi file dicocokkan dengan format yang diklaim
// - bukti ganda: hash isi file yang sama dengan klaim lain yang pending /
//   disetujui / sudah dibayar (siapa pun pemiliknya) ditolak dengan 409
// employee_id selalu dari sesi, status selalu 'pending', path bukti dibuat
// server — tidak ada yang dipercaya dari body.
// Upload ke storage dilakukan paling akhir, setelah semua validasi lolos.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['reimbursement']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: 'Data permintaan tidak valid.' }, { status: 400 });
    }

    const klaim = validasiKlaimReimbursement({
      kategori: formData.get('kategori'),
      jumlah: formData.get('jumlah'),
      deskripsi: formData.get('deskripsi'),
    });
    if (klaim.error) {
      return NextResponse.json({ error: klaim.error }, { status: 400 });
    }

    const file = formData.get('bukti');
    if (!file || typeof file === 'string' || file.size === 0) {
      return NextResponse.json({ error: 'Bukti/kuitansi wajib diupload.' }, { status: 400 });
    }
    const periksa = await periksaFileUpload(file, {
      mimeAllowed: BUKTI_REIMBURSEMENT_MIME,
      maksBytes: UPLOAD_MAX_BYTES,
      labelJenis: 'PDF, JPG, atau PNG',
      labelUkuran: UPLOAD_MAX_LABEL,
      nama: 'bukti',
    });
    if (periksa.error) {
      return NextResponse.json({ error: periksa.error }, { status: 400 });
    }
    const { buffer, mime, ext } = periksa;
    const buktiHash = hashIsiFile(buffer);

    const { data: ganda, error: gandaError } = await admin
      .from('reimbursement_requests')
      .select('id')
      .eq('bukti_hash', buktiHash)
      .in('status', STATUS_BLOKIR_BUKTI_GANDA)
      .limit(1);
    if (gandaError) {
      console.error('Cek bukti ganda reimbursement error:', gandaError);
      return NextResponse.json(
        { error: `Gagal memeriksa bukti: ${friendlyError(gandaError, 'terjadi kesalahan pada server.', { context: 'Cek bukti ganda reimbursement' })}` },
        { status: 500 }
      );
    }
    if (ganda && ganda.length > 0) {
      return NextResponse.json({ error: PESAN_BUKTI_GANDA }, { status: 409 });
    }

    const buktiPath = `${emp.id}/${Date.now()}-${buktiHash.slice(0, 12)}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET_BUKTI)
      .upload(buktiPath, buffer, { contentType: mime, upsert: false });
    if (uploadError) {
      console.error('Upload bukti reimbursement error:', uploadError);
      return NextResponse.json({ error: 'Gagal mengupload bukti. Coba lagi.' }, { status: 500 });
    }

    const { data, error: insertError } = await admin
      .from('reimbursement_requests')
      .insert([{
        employee_id: emp.id,
        kategori: klaim.kategori,
        jumlah: klaim.jumlah,
        deskripsi: klaim.deskripsi,
        bukti_path: buktiPath,
        bukti_hash: buktiHash,
        status: 'pending',
      }])
      .select()
      .single();

    if (insertError) {
      const { error: hapusError } = await admin.storage.from(BUCKET_BUKTI).remove([buktiPath]);
      if (hapusError) console.error('Gagal hapus bukti yatim reimbursement:', buktiPath, hapusError);

      // 23505 = indeks unik bukti_hash: dua pengajuan dengan bukti sama yang
      // masuk bersamaan, cek di atas lolos untuk keduanya.
      if (insertError.code === '23505') {
        return NextResponse.json({ error: PESAN_BUKTI_GANDA }, { status: 409 });
      }
      console.error('Ajukan reimbursement error:', insertError);
      return NextResponse.json(
        { error: `Gagal mengirim klaim: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Kirim klaim reimbursement' })}` },
        { status: 500 }
      );
    }

    await notifyByModule(admin, {
      moduleKey: 'reimbursement_admin',
      tipe: 'reimbursement_diajukan',
      pesan: `${emp.nama || 'Karyawan'} mengajukan klaim reimbursement ${formatRupiah(data.jumlah)} (${labelKategoriReimbursement(data.kategori).toLowerCase()}).`,
      link: '/employee/reimbursement/admin',
    });

    return NextResponse.json({ success: true, request: data }, { status: 201 });
  } catch (err) {
    console.error('Ajukan reimbursement error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
