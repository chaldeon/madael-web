import { google } from 'googleapis';
import { Readable } from 'stream';

/**
 * Upload CV ke Shared Drive "Madael Consult", otomatis dikelompokkan
 * ke dalam folder per posisi (dibuat kalau belum ada).
 *
 * @param {Buffer} fileBuffer - isi file CV (PDF) dalam bentuk Buffer
 * @param {string} fileName - nama file yang akan disimpan di Drive
 * @param {string} positionName - nama posisi, dipakai sebagai nama folder
 * @returns {Promise<string>} id file yang baru diupload di Google Drive
 */
export async function uploadCVToDrive(fileBuffer, fileName, positionName) {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const SHARED_DRIVE_ID = process.env.GOOGLE_SHARED_DRIVE_ID;

  if (!rawKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY belum diset di environment variables.');
  }
  if (!SHARED_DRIVE_ID) {
    throw new Error('GOOGLE_SHARED_DRIVE_ID belum diset di environment variables.');
  }

  const credentials = JSON.parse(rawKey);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  const drive = google.drive({ version: 'v3', auth });

  const safeFolderName = (positionName || 'Lainnya').trim();

  // Cari folder posisi yang sudah ada di Shared Drive
  const folderResponse = await drive.files.list({
    q: `name='${safeFolderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    driveId: SHARED_DRIVE_ID,
    corpora: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    fields: 'files(id, name)',
  });

  let folderId;
  if (folderResponse.data.files && folderResponse.data.files.length > 0) {
    folderId = folderResponse.data.files[0].id;
  } else {
    const newFolder = await drive.files.create({
      requestBody: {
        name: safeFolderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [SHARED_DRIVE_ID],
      },
      supportsAllDrives: true,
      fields: 'id',
    });
    folderId = newFolder.data.id;
  }

  // Upload CV ke dalam folder posisi
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