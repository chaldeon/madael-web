import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { isModuleGranted } from '@/lib/employeeModules';
import { notifyEmployee, notifyEmployees } from '@/lib/notify';
import {
  FEEDBACK_ALLOWED_MIME,
  FEEDBACK_MAX_FILE,
  FEEDBACK_MAX_TEXT,
} from '@/lib/feedbackConfig';

// Helper server-only untuk route /api/feedback/*.

export const FEEDBACK_BUCKET = 'feedback-attachments';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Gate semua route /api/feedback/admin/*: harus login DAN punya flag
// 'support_access' (baris eksplisit di employee_modules — superadmin tidak bypass).
// Return: { user, emp, admin } kalau lolos, atau { error, status } untuk respons JSON.
export async function requireSupportAccess() {
  const session = await getSessionEmployee('id, nama, status, is_superadmin');
  if (session.error) return session;

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from('employee_modules')
    .select('module_name')
    .eq('employee_id', session.emp.id)
    .eq('module_name', 'support_access');

  const allowed = isModuleGranted({
    isSuperadmin: !!session.emp.is_superadmin,
    moduleKeys: (rows || []).map((r) => r.module_name),
    key: 'support_access',
  });
  if (!allowed) return { error: 'Akses ditolak.', status: 403 };
  return { ...session, admin };
}

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

// Notifikasi lonceng ke pemilik tiket saat tim support membalas. Deep link
// /employee/dashboard?tiket=<id> membuka bubble langsung ke tiketnya
// (ditangani FeedbackBubble). Cukup satu notifikasi belum-dibaca per tiket,
// supaya balasan beruntun tidak menumpuk di lonceng.
export async function notifyTicketReply(admin, ticket, replierNama) {
  const link = `/employee/dashboard?tiket=${ticket.id}`;
  const { data: existing } = await admin
    .from('notifications')
    .select('id')
    .eq('user_id', ticket.employee_id)
    .eq('link', link)
    .eq('is_read', false)
    .limit(1);
  if (existing?.length) return;

  await notifyEmployee(admin, {
    userId: ticket.employee_id,
    tipe: 'tiket_dibalas',
    pesan: `Tiket #${ticket.ticket_no} (${ticket.modul_label}) dibalas oleh ${replierNama}.`,
    link,
  });
}

// Notifikasi lonceng ke SEMUA akun aktif dengan flag 'support_access' saat ada
// tiket baru / pesan baru dari pengguna. Deep link /employee/support?kelola=<id>
// membuka panel admin langsung ke tiketnya. Satu notifikasi belum-dibaca per
// tiket per penerima (pesan beruntun tidak menumpuk). Gagal kirim notifikasi
// tidak boleh menggagalkan pengiriman tiket, jadi semua error ditelan.
export async function notifySupportTeam(admin, ticket, { tipe, pesan, excludeId = null }) {
  try {
    const { data: holders } = await admin
      .from('employee_modules')
      .select('employee_id')
      .eq('module_name', 'support_access');
    const holderIds = [...new Set((holders || []).map((h) => h.employee_id))].filter((id) => id !== excludeId);
    if (holderIds.length === 0) return;

    const { data: active } = await admin
      .from('employees')
      .select('id')
      .in('id', holderIds)
      .eq('status', 'Aktif');
    const recipientIds = (active || []).map((e) => e.id);
    if (recipientIds.length === 0) return;

    const link = `/employee/support?kelola=${ticket.id}`;
    const { data: unread } = await admin
      .from('notifications')
      .select('user_id')
      .eq('link', link)
      .eq('is_read', false)
      .in('user_id', recipientIds);
    const alreadyNotified = new Set((unread || []).map((n) => n.user_id));
    const userIds = recipientIds.filter((id) => !alreadyNotified.has(id));
    if (userIds.length === 0) return;

    await notifyEmployees(admin, { userIds, tipe, pesan, link });
  } catch (err) {
    console.error('Notifikasi tim support gagal:', err);
  }
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
