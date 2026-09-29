import { randomUUID } from 'crypto';
import {
  FEEDBACK_ALLOWED_MIME,
  FEEDBACK_MAX_FILE,
  FEEDBACK_MAX_TEXT,
} from '@/lib/feedbackConfig';

// Helper server-only untuk route /api/feedback/*.

export const FEEDBACK_BUCKET = 'feedback-attachments';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// File kosong dari <input type="file"> yang tidak diisi dianggap "tidak ada lampiran".
export function readFile(formData) {
  const file = formData.get('file');
  if (!file || typeof file === 'string' || file.size === 0) return null;
  return file;
}

export function readIsi(formData) {
  return String(formData.get('isi') || '').trim();
}

// Return pesan error (string) atau null kalau valid.
export function validateIsi(isi) {
  if (!isi) return 'Deskripsi wajib diisi.';
  if (isi.length > FEEDBACK_MAX_TEXT) return `Maksimal ${FEEDBACK_MAX_TEXT} karakter.`;
  return null;
}

export function validateFile(file) {
  if (!file) return null;
  if (!FEEDBACK_ALLOWED_MIME.includes(file.type)) return 'Lampiran harus gambar JPG, PNG, atau WEBP.';
  if (file.size > FEEDBACK_MAX_FILE) return 'Ukuran lampiran maksimal 4MB.';
  return null;
}

export function cleanPath(value) {
  const raw = String(value || '').split('?')[0].split('#')[0].slice(0, 200);
  return raw.startsWith('/') ? raw : null;
}

export async function uploadAttachment(admin, employeeId, file) {
  const path = `${employeeId}/${randomUUID()}.${EXT[file.type]}`;
  const { error } = await admin.storage
    .from(FEEDBACK_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) throw error;
  return { path, name: (file.name || 'screenshot').slice(0, 100), mime: file.type };
}

// Hanya untuk membersihkan file yang sudah terupload tapi insert DB-nya gagal
// (file yatim); tiket/pesan di database tidak pernah dihapus.
export async function discardUploaded(admin, att) {
  if (att) await admin.storage.from(FEEDBACK_BUCKET).remove([att.path]).catch(() => {});
}

// Tambahkan attachment_url (signed URL 5 menit) ke tiap pesan yang punya lampiran.
export async function withSignedUrls(admin, messages) {
  return Promise.all(
    messages.map(async (m) => {
      if (!m.attachment_path) return m;
      const { data } = await admin.storage.from(FEEDBACK_BUCKET).createSignedUrl(m.attachment_path, 60 * 5);
      return { ...m, attachment_url: data?.signedUrl || null };
    })
  );
}

// Batas anti-spam sederhana — tiket & pesan tidak bisa dihapus, jadi dibatasi di depan.
export async function overRateLimit(admin, table, employeeColumn, employeeId, max) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq(employeeColumn, employeeId)
    .gte('created_at', since);
  return (count || 0) >= max;
}
