// Pengingat pengajuan yang menunggu terlalu lama — SERVER ONLY. Dipanggil oleh
// app/api/cron/pending-approval-reminder/route.js.
//
// Pengajuan berstatus 'pending' yang umurnya lebih dari PENDING_REMINDER_DAYS
// hari memicu SATU notifikasi in-app bertipe `pengajuan_tertunda` ke tiap
// penyetuju yang berhak, berisi ringkasan jumlah per jenis dan tautan ke Inbox
// Persetujuan (/employee/persetujuan).
//
// Definisi antrean dan hak akses memakai sumber yang SAMA dengan badge dashboard
// dan Inbox Persetujuan, supaya angka di pengingat identik dengan yang dilihat
// penyetuju saat membukanya:
//   - tabel/filter antrean   : PENDING_QUERIES (lib/pendingQueue.js)
//   - hak akses per modul    : isModuleGranted (lib/employeeModules.js)
//   - pengajuan milik sendiri: tidak dihitung (SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN)
//
// Idempoten: aman dipicu berkali-kali dalam sehari. Satu penyetuju paling banyak
// menerima SATU pengingat per hari (hari WIB), dicek dari tabel notifications
// (tidak butuh tabel log baru). Selama pengajuan masih menggantung, pengingat
// datang lagi keesokan harinya.
//
// Hanya in-app: tipe ini sengaja TIDAK dipetakan ke kategori email di
// lib/notificationEmailConfig.js (tipe baru tidak otomatis dikirimi email).
import { notifyEmployee } from '@/lib/notify';
import { todayJakarta } from '@/lib/serverTime';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { PENDING_QUERIES, applyPendingFilters } from '@/lib/pendingQueue';
import { PENDING_QUEUE_MODULES, isModuleGranted } from '@/lib/employeeModules';
import { SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN } from '@/lib/leave';

export const TIPE_PENGAJUAN_TERTUNDA = 'pengajuan_tertunda';
export const PENDING_REMINDER_DAYS = 3;
export const PENDING_REMINDER_LINK = '/employee/persetujuan';
const ID_CHUNK = 100;
const HARI_MS = 24 * 60 * 60 * 1000;

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Susun teks pengingat dari jumlah per jenis. `rincian` = [{ jenis, jumlah }].
export function buildPendingReminderMessage({ total, rincian, hariTertua, batasHari }) {
  const daftar = rincian.map((r) => `${r.jenis} ${r.jumlah}`).join(', ');
  return (
    `Ada ${total} pengajuan menunggu persetujuanmu lebih dari ${batasHari} hari (${daftar}). ` +
    `Yang paling lama sudah menunggu ${hariTertua} hari. Buka Inbox Persetujuan untuk meninjau.`
  );
}

// Pengajuan pending yang sudah lewat batas, per modul antrean:
// Map<moduleKey, [{ employee_id, created_at }]>. Modul yang gagal dibaca
// dicatat di log dan dilewati (satu tabel bermasalah tidak mematikan yang lain),
// kecuali SEMUA modul gagal — itu dilempar supaya cron mengembalikan 500.
async function loadOverdue(admin, cutoffIso) {
  const keys = PENDING_QUEUE_MODULES.filter((key) => PENDING_QUERIES[key]);
  const byKey = new Map();
  let gagal = 0;

  await Promise.all(
    keys.map(async (key) => {
      const config = PENDING_QUERIES[key];
      const { data, error } = await fetchAllRows(() =>
        applyPendingFilters(
          admin.from(config.table).select('id, employee_id, created_at'),
          config,
          { empId: null, excludeOwn: false }
        ).lt('created_at', cutoffIso)
      );
      if (error) {
        console.error(`Muat pengajuan tertunda ${key} error:`, error);
        gagal += 1;
        return;
      }
      if ((data || []).length > 0) byKey.set(key, data);
    })
  );

  if (gagal === keys.length && keys.length > 0) {
    throw new Error('Semua antrean pengajuan gagal dimuat.');
  }
  return byKey;
}

// Penyetuju kandidat: karyawan Aktif pemegang modul antrean manapun + semua
// superadmin. Return [{ id, is_superadmin, moduleKeys }].
async function loadApprovers(admin) {
  const { data: mods, error: modsError } = await fetchAllRows(() =>
    admin
      .from('employee_modules')
      .select('employee_id, module_name')
      .in('module_name', PENDING_QUEUE_MODULES)
  );
  if (modsError) throw modsError;

  const keysByEmp = new Map();
  for (const m of mods || []) {
    const id = String(m.employee_id);
    if (!keysByEmp.has(id)) keysByEmp.set(id, []);
    keysByEmp.get(id).push(m.module_name);
  }

  const { data: admins, error: adminsError } = await admin
    .from('employees')
    .select('id')
    .eq('is_superadmin', true);
  if (adminsError) throw adminsError;

  const candidateIds = Array.from(
    new Set([...keysByEmp.keys(), ...(admins || []).map((a) => String(a.id))])
  );

  const approvers = [];
  for (const ids of chunk(candidateIds, ID_CHUNK)) {
    const { data, error } = await admin
      .from('employees')
      .select('id, status, is_superadmin')
      .in('id', ids);
    if (error) throw error;
    for (const e of data || []) {
      if (e.status !== 'Aktif') continue;
      approvers.push({
        id: e.id,
        is_superadmin: !!e.is_superadmin,
        moduleKeys: keysByEmp.get(String(e.id)) || [],
      });
    }
  }
  return approvers;
}

// Mengembalikan { tanggal, batasHari, tertunda, penyetuju, diingatkan } atau
// melempar error bila pembacaan data gagal (pemanggil mengubahnya menjadi 500).
export async function runPendingApprovalReminder(admin, now = new Date()) {
  const tanggal = todayJakarta(now);
  const batasHari = PENDING_REMINDER_DAYS;
  const cutoffIso = new Date(now.getTime() - batasHari * HARI_MS).toISOString();

  // 1. Pengajuan pending yang sudah lewat batas.
  const overdue = await loadOverdue(admin, cutoffIso);
  const tertunda = Array.from(overdue.values()).reduce((n, rows) => n + rows.length, 0);
  if (tertunda === 0) return { tanggal, batasHari, tertunda: 0, penyetuju: 0, diingatkan: 0 };

  // 2. Per penyetuju: hitung hanya modul yang boleh dia akses dan buang
  //    pengajuan miliknya sendiri, persis seperti badge dan Inbox Persetujuan.
  const approvers = await loadApprovers(admin);
  const pesanPerOrang = new Map();

  for (const a of approvers) {
    const excludeOwn = !(SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN && a.is_superadmin);
    const rincian = [];
    let total = 0;
    let tertua = null;

    for (const key of PENDING_QUEUE_MODULES) {
      const rows = overdue.get(key);
      if (!rows) continue;
      if (!isModuleGranted({ isSuperadmin: a.is_superadmin, moduleKeys: a.moduleKeys, key })) continue;

      const config = PENDING_QUERIES[key];
      const dihitung = rows.filter(
        (r) => !(config.ownColumn && excludeOwn && String(r[config.ownColumn]) === String(a.id))
      );
      if (dihitung.length === 0) continue;

      rincian.push({ jenis: config.jenis, jumlah: dihitung.length });
      total += dihitung.length;
      for (const r of dihitung) {
        const t = new Date(r.created_at).getTime();
        if (Number.isFinite(t) && (tertua === null || t < tertua)) tertua = t;
      }
    }

    if (total === 0) continue;
    const hariTertua = Math.max(batasHari, Math.floor((now.getTime() - (tertua ?? now.getTime())) / HARI_MS));
    pesanPerOrang.set(String(a.id), {
      userId: a.id,
      pesan: buildPendingReminderMessage({ total, rincian, hariTertua, batasHari }),
    });
  }

  const kandidat = Array.from(pesanPerOrang.keys());
  if (kandidat.length === 0) {
    return { tanggal, batasHari, tertunda, penyetuju: 0, diingatkan: 0 };
  }

  // 3. Buang yang sudah diingatkan hari ini (sejak 00:00 WIB).
  const awalHari = `${tanggal}T00:00:00+07:00`;
  const sudah = new Set();
  for (const ids of chunk(kandidat, ID_CHUNK)) {
    const { data, error } = await admin
      .from('notifications')
      .select('user_id')
      .eq('tipe', TIPE_PENGAJUAN_TERTUNDA)
      .gte('created_at', awalHari)
      .in('user_id', ids);
    if (error) throw error;
    for (const n of data || []) sudah.add(String(n.user_id));
  }
  const target = kandidat.filter((id) => !sudah.has(id));

  for (const id of target) {
    const { userId, pesan } = pesanPerOrang.get(id);
    await notifyEmployee(admin, {
      userId,
      tipe: TIPE_PENGAJUAN_TERTUNDA,
      pesan,
      link: PENDING_REMINDER_LINK,
    });
  }

  return {
    tanggal,
    batasHari,
    tertunda,
    penyetuju: kandidat.length,
    diingatkan: target.length,
  };
}
