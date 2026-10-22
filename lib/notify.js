// Helper notifikasi in-app — SERVER ONLY.
// `supabase` WAJIB client service role (createAdminClient()). Browser tidak
// punya izin INSERT ke tabel notifications (dicabut di
// sql/20261015_notifikasi_activity_log_server_side.sql); dari browser, pakai
// dispatchNotification() di lib/notifyClient.js, yang lewat
// /api/notifications/dispatch.
// Sengaja "fire and forget" dengan try/catch — kalau insert notifikasi gagal,
// jangan sampai membatalkan/mengganggu aksi utama yang sudah berhasil disimpan.
import { after } from 'next/server';
import { safeInternalPath } from '@/lib/safeLink';
import { sendNotificationEmails } from '@/lib/notificationEmail';

// Kanal email (lib/notificationEmail.js) dijalankan SETELAH notifikasi in-app
// tersimpan. Dijadwalkan lewat after() supaya respons API tidak menunggu SMTP;
// di luar request scope (mis. skrip) after() melempar error, maka jatuh ke
// await biasa. Sendiri tidak pernah melempar error.
function kirimEmail(supabase, payload) {
  const job = () => sendNotificationEmails(supabase, payload);
  try {
    after(job);
    return undefined;
  } catch {
    return job();
  }
}

// Kirim notifikasi ke satu employee tertentu (employees.id).
export async function notifyEmployee(supabase, { userId, tipe, pesan, link = null }) {
  if (!userId) return;
  try {
    const { error } = await supabase
      .from('notifications')
      .insert([{ user_id: userId, tipe, pesan, link: safeInternalPath(link) }]);
    if (error) {
      console.error('Gagal mengirim notifikasi:', error);
      return;
    }
    await kirimEmail(supabase, { userIds: [userId], tipe, pesan, link });
  } catch (err) {
    console.error('Gagal mengirim notifikasi:', err);
  }
}

// Kirim notifikasi ke beberapa employee sekaligus (mis. semua yang punya
// payslip di satu payroll run).
export async function notifyEmployees(supabase, { userIds, tipe, pesan, link = null }) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  if (ids.length === 0) return;
  try {
    const { error } = await supabase.from('notifications').insert(
      ids.map((id) => ({ user_id: id, tipe, pesan, link: safeInternalPath(link) }))
    );
    if (error) {
      console.error('Gagal mengirim notifikasi massal:', error);
      return;
    }
    await kirimEmail(supabase, { userIds: ids, tipe, pesan, link });
  } catch (err) {
    console.error('Gagal mengirim notifikasi massal:', err);
  }
}

// Kirim notifikasi ke semua superadmin — dipakai untuk "cuti diajukan (ke
// admin)" karena tidak ada satu akun admin tunggal di sistem ini.
export async function notifySuperadmins(supabase, { tipe, pesan, link = null }) {
  try {
    const { data: admins } = await supabase
      .from('employees')
      .select('id')
      .eq('is_superadmin', true);

    await notifyEmployees(supabase, {
      userIds: (admins || []).map((a) => a.id),
      tipe,
      pesan,
      link,
    });
  } catch (err) {
    console.error('Gagal mengirim notifikasi ke superadmin:', err);
  }
}

// Kirim notifikasi ke semua employee yang punya akses ke modul tertentu
// (employee_modules.module_name = moduleKey), ditambah semua superadmin
// (superadmin selalu punya akses ke semua modul walau tidak selalu tercatat
// baris employee_modules-nya). Dipakai mis. untuk "ada pelamar baru" ke
// semua pemegang akses modul job_portal.
export async function notifyByModule(supabase, { moduleKey, tipe, pesan, link = null }) {
  try {
    const [modsRes, adminsRes] = await Promise.all([
      supabase.from('employee_modules').select('employee_id').eq('module_name', moduleKey),
      supabase.from('employees').select('id').eq('is_superadmin', true),
    ]);

    const ids = [
      ...(modsRes.data || []).map((m) => m.employee_id),
      ...(adminsRes.data || []).map((a) => a.id),
    ];

    await notifyEmployees(supabase, { userIds: ids, tipe, pesan, link });
  } catch (err) {
    console.error(`Gagal mengirim notifikasi ke pemegang modul ${moduleKey}:`, err);
  }
}

// Kirim notifikasi ke semua employee berstatus Aktif — dipakai untuk
// broadcast pengumuman internal (Papan Pengumuman) yang company-wide,
// bukan spesifik ke satu modul kerja tertentu.
export async function notifyAllActive(supabase, { tipe, pesan, link = null }) {
  try {
    const { data: emps } = await supabase
      .from('employees')
      .select('id')
      .eq('status', 'Aktif');

    await notifyEmployees(supabase, {
      userIds: (emps || []).map((e) => e.id),
      tipe,
      pesan,
      link,
    });
  } catch (err) {
    console.error('Gagal mengirim notifikasi broadcast ke semua employee:', err);
  }
}