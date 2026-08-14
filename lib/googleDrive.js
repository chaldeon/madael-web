import { google } from 'googleapis';
import { Readable } from 'stream';

// Nama folder root tempat semua dokumen employee (KTP, PKWT, ijazah, dll)
// dikelompokkan di Shared Drive, supaya tidak campur dengan folder per-posisi
// yang dipakai CV job portal (lihat uploadCVToDrive di bawah).
const EMPLOYEE_DOCS_ROOT_FOLDER = 'Dokumen Karyawan';

// Tiap kategori dokumen punya Shared Drive sendiri (dipisah demi keamanan
// data — lihat diskusi arsitektur), jadi getDriveClient menerima nama env
// var ID drive yang mau dipakai, bukan selalu satu drive yang sama.
// Default ke GOOGLE_SHARED_DRIVE_ID (drive lama: CV + dokumen karyawan) untuk
// menjaga fungsi-fungsi existing tetap jalan tanpa perlu diubah satu-satu.
function getDriveClient(driveIdEnvVar = 'GOOGLE_SHARED_DRIVE_ID') {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const SHARED_DRIVE_ID = process.env[driveIdEnvVar];

  if (!rawKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY belum diset di environment variables.');
  }
  if (!SHARED_DRIVE_ID) {
    throw new Error(`${driveIdEnvVar} belum diset di environment variables.`);
  }

  const credentials = JSON.parse(rawKey);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  return { drive: google.drive({ version: 'v3', auth }), SHARED_DRIVE_ID };
}

// Cari folder dengan nama tertentu di dalam parentId (root Shared Drive kalau
// parentId = SHARED_DRIVE_ID), buat baru kalau belum ada. Dipakai baik untuk
// folder per-posisi (CV) maupun folder root/per-employee (dokumen karyawan).
async function findOrCreateFolder(drive, name, parentId, sharedDriveId) {
  const safeName = (name || 'Lainnya').trim();

  const folderResponse = await drive.files.list({
    q: `name='${safeName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
    driveId: sharedDriveId,
    corpora: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    fields: 'files(id, name)',
  });

  if (folderResponse.data.files && folderResponse.data.files.length > 0) {
    return folderResponse.data.files[0].id;
  }

  const newFolder = await drive.files.create({
    requestBody: {
      name: safeName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    supportsAllDrives: true,
    fields: 'id',
  });
  return newFolder.data.id;
}

/**
 * Upload CV ke Shared Drive, otomatis dikelompokkan ke dalam folder per
 * posisi (dibuat kalau belum ada).
 *
 * @param {Buffer} fileBuffer - isi file CV (PDF) dalam bentuk Buffer
 * @param {string} fileName - nama file yang akan disimpan di Drive
 * @param {string} positionName - nama posisi, dipakai sebagai nama folder
 * @returns {Promise<string>} id file yang baru diupload di Google Drive
 */
export async function uploadCVToDrive(fileBuffer, fileName, positionName) {
  const { drive, SHARED_DRIVE_ID } = getDriveClient();

  const folderId = await findOrCreateFolder(drive, positionName, SHARED_DRIVE_ID, SHARED_DRIVE_ID);

  const uploadResponse = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: 'application/pdf',
      body: Readable.from(fileBuffer),
    },
    supportsAllDrives: true,
    fields: 'id, webViewLink',
  });

  return uploadResponse.data.id;
}

/**
 * Upload dokumen employee (KTP, PKWT, ijazah, dll) ke Shared Drive, di dalam
 * folder root "Dokumen Karyawan" > subfolder per employee (dibuat kalau
 * belum ada). Terpisah dari folder per-posisi yang dipakai CV supaya tidak
 * campur.
 *
 * @param {Buffer} fileBuffer - isi file dalam bentuk Buffer
 * @param {string} fileName - nama file yang akan disimpan di Drive
 * @param {string} mimeType - mime type file asli (PDF/JPG/PNG, dll)
 * @param {string} employeeFolderName - nama subfolder employee, mis. "Budi Santoso (EMP-012)"
 * @returns {Promise<{fileId: string, webViewLink: string}>}
 */
export async function uploadEmployeeDocumentToDrive(fileBuffer, fileName, mimeType, employeeFolderName) {
  const { drive, SHARED_DRIVE_ID } = getDriveClient();

  const rootFolderId = await findOrCreateFolder(drive, EMPLOYEE_DOCS_ROOT_FOLDER, SHARED_DRIVE_ID, SHARED_DRIVE_ID);
  const employeeFolderId = await findOrCreateFolder(drive, employeeFolderName, rootFolderId, SHARED_DRIVE_ID);

  const uploadResponse = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [employeeFolderId],
    },
    media: {
      mimeType: mimeType || 'application/octet-stream',
      body: Readable.from(fileBuffer),
    },
    supportsAllDrives: true,
    fields: 'id, webViewLink',
  });

  return { fileId: uploadResponse.data.id, webViewLink: uploadResponse.data.webViewLink };
}

// Nama folder root di dalam Shared Drive "Absensi" tempat foto bukti
// pengajuan koreksi kehadiran dikelompokkan per employee.
const ATTENDANCE_EVIDENCE_ROOT_FOLDER = 'Bukti Koreksi Absensi';

/**
 * Upload foto bukti pengajuan koreksi absensi ke Shared Drive "Absensi"
 * (terpisah dari drive CV/dokumen karyawan), di folder root
 * "Bukti Koreksi Absensi" > subfolder per employee.
 *
 * @param {Buffer} fileBuffer
 * @param {string} fileName
 * @param {string} mimeType
 * @param {string} employeeFolderName - mis. "Budi Santoso (a1b2c3d4)"
 * @returns {Promise<{fileId: string, webViewLink: string}>}
 */
export async function uploadAttendanceEvidenceToDrive(fileBuffer, fileName, mimeType, employeeFolderName) {
  const { drive, SHARED_DRIVE_ID } = getDriveClient('GOOGLE_SHARED_DRIVE_ID_ABSENSI');

  const rootFolderId = await findOrCreateFolder(drive, ATTENDANCE_EVIDENCE_ROOT_FOLDER, SHARED_DRIVE_ID, SHARED_DRIVE_ID);
  const employeeFolderId = await findOrCreateFolder(drive, employeeFolderName, rootFolderId, SHARED_DRIVE_ID);

  const uploadResponse = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [employeeFolderId],
    },
    media: {
      mimeType: mimeType || 'image/jpeg',
      body: Readable.from(fileBuffer),
    },
    supportsAllDrives: true,
    fields: 'id, webViewLink',
  });

  return { fileId: uploadResponse.data.id, webViewLink: uploadResponse.data.webViewLink };
}

/**
 * Hapus file dokumen employee dari Drive (dipanggil saat admin hapus record
 * employee_documents). Gagal hapus di Drive tidak fatal untuk caller — biar
 * caller yang putuskan mau lanjut hapus row Supabase atau tidak.
 *
 * @param {string} fileId - id file Google Drive
 */
export async function deleteEmployeeDocumentFromDrive(fileId) {
  const { drive } = getDriveClient();
  await drive.files.delete({ fileId, supportsAllDrives: true });
}
