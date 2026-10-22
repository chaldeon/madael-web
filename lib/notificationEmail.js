// Kanal email untuk notifikasi karyawan — SERVER ONLY.
//
// Dipanggil dari lib/notify.js SETELAH notifikasi in-app berhasil disimpan, jadi
// semua jalur yang sudah memakai notify* (rute API, /api/notifications/dispatch,
// feedbackServer, pengingat clock-out) otomatis ikut mengirim email bila
// tipenya terdaftar di lib/notificationEmailConfig.js.
//
// Aturan:
//   - Hanya tipe yang dipetakan ke kategori email yang dikirimi email.
//   - Penerima harus karyawan berstatus Aktif dengan email terisi.
//   - Preferensi per karyawan (notification_preferences) dihormati; tanpa baris
//     = semua kategori aktif. Kalau tabel preferensi gagal dibaca (mis. migrasi
//     belum dijalankan), email TIDAK dikirim: opt-out tidak bisa dipastikan.
//   - Kegagalan email tidak pernah melempar error ke pemanggil; notifikasi
//     in-app sudah tersimpan dan aksi utama tidak boleh terganggu.
//
// Env: SMTP_* dan MAIL_FROM (sama dengan email pelamar, lihat
// lib/applicationEmail.js). Opsional APP_BASE_URL (mis. https://madael.id) untuk
// membentuk tautan absolut di email; bawaan https://madael.id.
import { isMailConfigured, sendEmail } from '@/lib/applicationEmail';
import { safeInternalPath } from '@/lib/safeLink';
import { EMAIL_CATEGORIES, getEmailCategory } from '@/lib/notificationEmailConfig';

const COMPANY = 'Madael Consult';
const DEFAULT_BASE_URL = 'https://madael.id';
const ID_CHUNK = 100; // batas panjang URL PostgREST untuk .in()
const SEND_CONCURRENCY = 5;

function baseUrl() {
  const raw = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Isi email untuk satu penerima. `pesan` berasal dari teks notifikasi (bisa
// memuat alasan penolakan yang diketik orang), jadi selalu di-escape.
export function buildNotificationEmail({ kategori, nama, pesan, link }) {
  const def = EMAIL_CATEGORIES[kategori];
  const path = safeInternalPath(link);
  const url = path ? `${baseUrl()}${path}` : null;
  const prefsUrl = `${baseUrl()}/employee/notifications`;
  const sapaan = `Halo ${nama || 'rekan'},`;
  const footer = `Email ini dikirim otomatis oleh sistem ${COMPANY}. Atur atau matikan email notifikasi di Pusat Notifikasi: ${prefsUrl}`;

  const text = [sapaan, '', pesan, ...(url ? ['', `Buka di Madael: ${url}`] : []), '', footer].join('\n');

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222">
<p>${escapeHtml(sapaan)}</p>
<p>${escapeHtml(pesan)}</p>
${url ? `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#C1272D;color:#fff;padding:10px 20px;text-decoration:none">Buka di Madael</a></p>` : ''}
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
<p style="font-size:12px;color:#777">Email ini dikirim otomatis oleh sistem ${escapeHtml(COMPANY)}. Atur atau matikan email notifikasi di <a href="${escapeHtml(prefsUrl)}">Pusat Notifikasi</a>.</p>
</div>`;

  return { subject: `${def.subject} — ${COMPANY}`, text, html };
}

async function loadRecipients(supabase, userIds, column) {
  const recipients = [];
  for (const ids of chunk(userIds, ID_CHUNK)) {
    const [empRes, prefRes] = await Promise.all([
      supabase.from('employees').select('id, nama, email, status').in('id', ids),
      supabase.from('notification_preferences').select(`employee_id, ${column}`).in('employee_id', ids),
    ]);
    if (empRes.error) throw empRes.error;
    if (prefRes.error) throw prefRes.error; // jangan kirim kalau opt-out tak bisa dipastikan

    const nonaktif = new Set(
      (prefRes.data || []).filter((p) => p[column] === false).map((p) => String(p.employee_id))
    );
    for (const e of empRes.data || []) {
      if (e.status !== 'Aktif' || !e.email) continue;
      if (nonaktif.has(String(e.id))) continue;
      recipients.push(e);
    }
  }
  return recipients;
}

// Kirim email untuk notifikasi `tipe` ke `userIds` (employees.id). Mengembalikan
// { sent, failed }; tidak pernah melempar error.
export async function sendNotificationEmails(supabase, { userIds, tipe, pesan, link = null }) {
  const result = { sent: 0, failed: 0 };
  try {
    const kategori = getEmailCategory(tipe);
    if (!kategori) return result;
    if (!isMailConfigured()) return result;

    const ids = Array.from(new Set((userIds || []).filter(Boolean)));
    if (ids.length === 0) return result;

    const recipients = await loadRecipients(supabase, ids, EMAIL_CATEGORIES[kategori].column);

    for (const batch of chunk(recipients, SEND_CONCURRENCY)) {
      const settled = await Promise.allSettled(
        batch.map((r) =>
          sendEmail({ to: r.email, ...buildNotificationEmail({ kategori, nama: r.nama, pesan, link }) })
        )
      );
      settled.forEach((s, i) => {
        if (s.status === 'fulfilled') {
          result.sent += 1;
        } else {
          result.failed += 1;
          // Sengaja tanpa alamat email di log; cukup id karyawan.
          console.error(`Gagal mengirim email notifikasi (${tipe}) ke karyawan ${batch[i].id}:`, s.reason);
        }
      });
    }
  } catch (err) {
    console.error(`Gagal menyiapkan email notifikasi (${tipe}):`, err);
  }
  return result;
}
