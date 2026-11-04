import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { notifyByModule } from '@/lib/notify';
import { friendlyError } from '@/lib/errorMessage';
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL } from '@/lib/uploadLimits';
import { periksaFileUpload } from '@/lib/uploadServer';

const BUCKET = 'employee-photos';
const MIME_FOTO_REFERENSI = { 'image/jpeg': 'jpg' };

// POST /api/profile/foto-referensi   multipart/form-data: foto (file JPEG), descriptor (JSON, 128 angka)
// Karyawan mendaftarkan atau mengganti foto referensi wajahnya sendiri — dasar
// verifikasi wajah saat clock in/out (lib/attendanceClock.js). Dulu browser
// meng-upload foto langsung ke bucket 'employee-photos' (upsert: true) lalu
// mengirim `path` bebas ke route ini, yang menyimpannya apa adanya lewat service
// role. Akibatnya `path` bisa menunjuk berkas siapa pun dan penggantian referensi
// tidak meninggalkan jejak. Sekarang:
// - foto di-upload oleh SERVER; `path` dibuat server di folder milik karyawan
//   itu sendiri (`<employees.id>/reference-<waktu>.jpg`), tidak pernah dari klien
// - setiap upload memakai nama baru: foto referensi sebelumnya TIDAK ditimpa
//   dan tidak dihapus, jadi bisa ditelusuri bila ada dugaan titip absen
// - tipe file dicek dari isi (JPEG), maks 4MB
// - setiap pendaftaran/penggantian dicatat di Activity Log (path lama -> baru);
//   penggantian (sudah ada referensi sebelumnya) juga memberi tahu pemegang
//   modul profile_admin dan superadmin
// Catatan: descriptor tetap berasal dari klien (face-api.js jalan di browser);
// server tidak bisa mencocokkannya dengan foto.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['profile']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: 'Data permintaan tidak valid.' }, { status: 400 });
    }

    let descriptor = null;
    const descriptorMentah = formData.get('descriptor');
    if (typeof descriptorMentah === 'string') {
      try {
        descriptor = JSON.parse(descriptorMentah);
      } catch {
        descriptor = null;
      }
    }
    if (
      !Array.isArray(descriptor)
      || descriptor.length !== 128
      || !descriptor.every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      return NextResponse.json({ error: 'Data foto referensi tidak valid.' }, { status: 400 });
    }

    const file = formData.get('foto');
    if (!file || typeof file === 'string' || file.size === 0) {
      return NextResponse.json({ error: 'Foto referensi wajib diupload.' }, { status: 400 });
    }
    const periksa = await periksaFileUpload(file, {
      mimeAllowed: MIME_FOTO_REFERENSI,
      maksBytes: UPLOAD_MAX_BYTES,
      labelJenis: 'JPG',
      labelUkuran: UPLOAD_MAX_LABEL,
      nama: 'foto',
    });
    if (periksa.error) {
      return NextResponse.json({ error: periksa.error }, { status: 400 });
    }
    const { buffer, mime, ext } = periksa;

    // Referensi yang berlaku saat ini dibaca dari database, bukan dari klien.
    const { data: saatIni, error: saatIniError } = await admin
      .from('employees')
      .select('foto_referensi_url')
      .eq('id', emp.id)
      .maybeSingle();
    if (saatIniError) {
      console.error('Simpan foto referensi — baca data saat ini error:', saatIniError);
      return NextResponse.json(
        { error: `Gagal memuat data karyawan: ${friendlyError(saatIniError, 'terjadi kesalahan pada server.', { context: 'Muat foto referensi saat ini' })}` },
        { status: 500 }
      );
    }
    const pathLama = saatIni?.foto_referensi_url || null;

    const pathBaru = `${emp.id}/reference-${Date.now()}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(pathBaru, buffer, { contentType: mime, upsert: false });
    if (uploadError) {
      console.error('Simpan foto referensi — upload error:', uploadError);
      return NextResponse.json(
        { error: `Gagal mengupload foto referensi: ${friendlyError(uploadError, 'terjadi kesalahan pada server.', { context: 'Upload foto referensi' })}` },
        { status: 500 }
      );
    }

    const { error: updateError } = await admin
      .from('employees')
      .update({
        foto_referensi_url: pathBaru,
        foto_referensi_descriptor: descriptor,
      })
      .eq('id', emp.id);
    if (updateError) {
      console.error('Simpan foto referensi — update error:', updateError);
      // Berkas baru belum dipakai siapa pun; buang supaya tidak jadi sisa.
      // Foto lama tidak disentuh.
      await admin.storage.from(BUCKET).remove([pathBaru]).catch(() => {});
      return NextResponse.json(
        { error: `Gagal menyimpan foto referensi: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Simpan foto referensi' })}` },
        { status: 500 }
      );
    }

    const diganti = !!pathLama;
    await logActivity(admin, {
      userId: emp.id,
      aksi: diganti ? 'ganti_foto_referensi' : 'daftar_foto_referensi',
      targetTable: 'employees',
      targetId: emp.id,
      detail: {
        before: { foto_referensi_url: pathLama },
        after: { foto_referensi_url: pathBaru },
      },
    });

    if (diganti) {
      await notifyByModule(admin, {
        moduleKey: 'profile_admin',
        tipe: 'profil_foto_referensi_diganti',
        pesan: `${emp.nama || 'Karyawan'} mengganti foto referensi wajahnya (dipakai untuk verifikasi absensi).`,
        link: '/employee/profile/admin',
      });
    }

    return NextResponse.json({ success: true, path: pathBaru }, { status: 200 });
  } catch (err) {
    console.error('Simpan foto referensi error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
