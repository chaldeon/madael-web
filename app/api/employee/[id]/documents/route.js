import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { uploadEmployeeDocumentToDrive, deleteEmployeeDocumentFromDrive } from '@/lib/googleDrive';
import { friendlyError } from '@/lib/errorMessage';
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL } from '@/lib/uploadLimits';
import { JENIS_DOKUMEN_OPTIONS, JENIS_KOLOM, KETERANGAN_MAX_LENGTH } from '@/lib/employeeDocumentsConfig';
import {
  DOC_ID_RE,
  STORAGE_BUCKET,
  authorizeEmployeeDocuments,
  bolehHapusDokumen,
  normalisasiDokumen,
  urutkanTerbaru,
} from '@/lib/employeeDocumentsServer';

// Satu-satunya jalur dokumen pribadi karyawan (KTP, NPWP, Ijazah, Kontrak, dll).
// [id] boleh id employees_master ATAU id employees (akun login) — lihat
// resolveEmployeeTarget. File baru selalu ke Google Drive; baris lama yang
// masih di Supabase Storage tetap bisa dilihat & dihapus lewat route ini.
//
// Akses: superadmin (semua karyawan) atau karyawan itu sendiri (dokumen
// miliknya). Hapus: lihat bolehHapusDokumen.

const MIME_EXT = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
};

function jsonError(error, status) {
  return NextResponse.json({ error }, { status });
}

// Nama untuk ditampilkan (file_name): nama asli tanpa karakter aneh, ekstensi
// disamakan dengan tipe file yang lolos validasi.
function namaTampilan(originalName, ext) {
  const base = String(originalName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N} _().-]/gu, '_')
    .trim()
    .slice(0, 80);
  return `${base || 'dokumen'}.${ext}`;
}

// GET /api/employee/[id]/documents — daftar dokumen (gabungan dua skema lama)
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    const auth = await authorizeEmployeeDocuments(admin, id);
    if (auth.error) return jsonError(auth.error, auth.status);
    const { emp, target, isSuperadmin } = auth;

    // select('*') + urut di JS: dua skema lama memakai nama kolom tanggal yang
    // berbeda (created_at / uploaded_at), jadi tidak mengandalkan salah satunya.
    const { data: rows, error } = await admin
      .from('employee_documents')
      .select('*')
      .in('employee_id', target.keys);
    if (error) throw error;

    const documents = urutkanTerbaru(rows || []).map((row) => normalisasiDokumen(row, { emp, isSuperadmin }));
    return NextResponse.json({ documents }, { status: 200 });
  } catch (err) {
    console.error('Employee documents list error:', err);
    return jsonError('Terjadi kesalahan server saat memuat dokumen.', 500);
  }
}

// POST /api/employee/[id]/documents — upload dokumen baru ke Google Drive
// FormData: jenis, label (opsional), file
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    const auth = await authorizeEmployeeDocuments(admin, id);
    if (auth.error) return jsonError(auth.error, auth.status);
    const { emp, target, isSuperadmin } = auth;

    const formData = await request.formData();
    const jenis = (formData.get('jenis') || '').toString().trim();
    const label = (formData.get('label') || '').toString().trim();
    const file = formData.get('file');

    if (!JENIS_DOKUMEN_OPTIONS.includes(jenis)) {
      return jsonError('Jenis dokumen tidak valid.', 400);
    }
    if (label.length > KETERANGAN_MAX_LENGTH) {
      return jsonError(`Keterangan maksimal ${KETERANGAN_MAX_LENGTH} karakter.`, 400);
    }
    if (!file || typeof file === 'string') {
      return jsonError('File wajib diupload.', 400);
    }
    const ext = MIME_EXT[file.type];
    if (!ext) {
      return jsonError('Format file harus PDF, JPG, atau PNG.', 400);
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      return jsonError(`Ukuran file maksimal ${UPLOAD_MAX_LABEL}.`, 400);
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const driveFileName = `${jenis.replace(/[^a-zA-Z0-9]+/g, '_')}_${Date.now()}.${ext}`;
    const employeeFolderName = `${target.nama} (${target.canonicalId.slice(0, 8)})`;

    let uploadResult;
    try {
      uploadResult = await uploadEmployeeDocumentToDrive(fileBuffer, driveFileName, file.type, employeeFolderName);
    } catch (driveError) {
      console.error('Google Drive upload error:', driveError);
      return jsonError('Gagal mengupload dokumen ke Google Drive. Silakan coba lagi.', 500);
    }

    const { data: docRow, error: insertError } = await admin
      .from('employee_documents')
      .insert([{
        employee_id: target.canonicalId,
        jenis: JENIS_KOLOM[jenis] || jenis,
        label: label || null,
        nama_dokumen: jenis === 'Lainnya' && label ? `Lainnya: ${label}` : jenis,
        file_name: namaTampilan(file.name, ext),
        drive_file_id: uploadResult.fileId,
        uploaded_by: emp.id,
      }])
      .select()
      .single();

    if (insertError) {
      // File sudah di Drive tapi barisnya gagal tersimpan: bersihkan supaya
      // tidak jadi file yatim yang tidak terlihat di aplikasi.
      try {
        await deleteEmployeeDocumentFromDrive(uploadResult.fileId);
      } catch (cleanupError) {
        console.error('Gagal membersihkan file Drive setelah insert gagal:', uploadResult.fileId, cleanupError);
      }
      return jsonError(
        'Gagal menyimpan data dokumen: ' + friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Simpan metadata dokumen employee' }),
        500
      );
    }

    return NextResponse.json(
      { success: true, document: normalisasiDokumen(docRow, { emp, isSuperadmin }) },
      { status: 200 }
    );
  } catch (err) {
    console.error('Employee documents upload error:', err);
    return jsonError('Terjadi kesalahan server.', 500);
  }
}

// DELETE /api/employee/[id]/documents?docId=xxx — hapus file (Drive atau
// Storage) lalu barisnya. File dihapus DULU dan kegagalannya menghentikan
// proses (baris tetap ada, bisa dicoba lagi); file yang memang sudah tidak ada
// (404) dianggap sudah terhapus. Jadi tidak pernah ada baris hilang dengan
// file yatim, dan mengulang setelah gagal aman.
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    const auth = await authorizeEmployeeDocuments(admin, id);
    if (auth.error) return jsonError(auth.error, auth.status);
    const { emp, target, isSuperadmin } = auth;

    const docId = new URL(request.url).searchParams.get('docId');
    if (!docId || !DOC_ID_RE.test(docId)) {
      return jsonError('docId wajib diisi dengan benar.', 400);
    }

    // Wajib milik karyawan [id] — docId dari URL tidak boleh menghapus
    // dokumen karyawan lain.
    const { data: row, error: findError } = await admin
      .from('employee_documents')
      .select('*')
      .eq('id', docId)
      .in('employee_id', target.keys)
      .maybeSingle();
    if (findError) throw findError;
    if (!row) return jsonError('Dokumen tidak ditemukan.', 404);

    if (!bolehHapusDokumen({ row, emp, isSuperadmin })) {
      return jsonError(
        'Dokumen ini tidak bisa kamu hapus. Hubungi HR bila perlu menghapusnya.',
        403
      );
    }

    if (row.drive_file_id) {
      try {
        await deleteEmployeeDocumentFromDrive(row.drive_file_id);
      } catch (driveError) {
        const sudahTidakAda = driveError?.code === 404 || driveError?.status === 404;
        if (!sudahTidakAda) {
          console.error('Gagal hapus file di Drive:', row.drive_file_id, driveError);
          return jsonError('Gagal menghapus file di Google Drive. Dokumen belum dihapus, silakan coba lagi.', 502);
        }
      }
    } else if (row.file_path) {
      const { error: storageError } = await admin.storage.from(STORAGE_BUCKET).remove([row.file_path]);
      if (storageError) {
        console.error('Gagal hapus file di Storage:', row.file_path, storageError);
        return jsonError('Gagal menghapus file di penyimpanan. Dokumen belum dihapus, silakan coba lagi.', 502);
      }
    }

    const { error: deleteError } = await admin.from('employee_documents').delete().eq('id', row.id);
    if (deleteError) {
      return jsonError(
        'Gagal menghapus data dokumen: ' + friendlyError(deleteError, 'terjadi kesalahan pada server.', { context: 'Hapus data dokumen employee' }),
        500
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('Employee documents delete error:', err);
    return jsonError('Terjadi kesalahan server.', 500);
  }
}
