import { getSessionEmployee } from '@/lib/sessionEmployee';
import { isDokumenKontrak } from '@/lib/employeeDocumentsConfig';

// SERVER ONLY — logika bersama route dokumen karyawan.
//
// Dulu ada dua jalur yang saling tidak terlihat: karyawan mengunggah dari
// browser ke Supabase Storage (kunci employees.id), HR mengunggah lewat API ke
// Google Drive (kunci employees_master.id). Sekarang semuanya lewat route
// server; helper ini yang memetakan kedua kunci itu ke satu karyawan.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DOC_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
export const STORAGE_BUCKET = 'employee-documents';
export const TIPE_KONTEN = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

// Terima id employees_master ATAU id employees (akun login), kembalikan:
//   keys        : semua nilai employee_documents.employee_id milik karyawan ini
//                 (id master + id akun) — dipakai untuk membaca/mencocokkan baris
//   accountId   : employees.id (null kalau master belum di-link ke akun)
//   canonicalId : kunci untuk baris BARU — id master bila ada (sumber data
//                 karyawan), kalau tidak ada master pakai id akun
//   nama        : dipakai sebagai nama subfolder Drive
// null bila id tidak dikenal. Melempar error bila query gagal.
export async function resolveEmployeeTarget(admin, rawId) {
  if (!UUID_RE.test(String(rawId || ''))) return null;

  const { data: master, error: masterError } = await admin
    .from('employees_master')
    .select('id, nama, linked_employee_id')
    .eq('id', rawId)
    .maybeSingle();
  if (masterError) throw masterError;

  if (master) {
    const accountId = master.linked_employee_id || null;
    return {
      keys: [...new Set([master.id, accountId].filter(Boolean))],
      accountId,
      canonicalId: master.id,
      nama: master.nama,
    };
  }

  const { data: account, error: accountError } = await admin
    .from('employees')
    .select('id, nama')
    .eq('id', rawId)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account) return null;

  const { data: masters, error: linkedError } = await admin
    .from('employees_master')
    .select('id, nama')
    .eq('linked_employee_id', account.id);
  if (linkedError) throw linkedError;

  const masterIds = (masters || []).map((m) => m.id);
  return {
    keys: [...new Set([...masterIds, account.id])],
    accountId: account.id,
    canonicalId: masterIds[0] || account.id,
    nama: masters?.[0]?.nama || account.nama,
  };
}

// Login + akun aktif + (superadmin ATAU pemilik dokumen). Pemilik = akun login
// yang terhubung ke karyawan target. Selain itu dijawab 404 (sama seperti
// karyawan tidak ada) supaya keberadaan karyawan lain tidak bocor.
// Return { emp, target, isSuperadmin, isSelf } atau { error, status }.
export async function authorizeEmployeeDocuments(admin, rawId) {
  const session = await getSessionEmployee('id, nama, status, is_superadmin');
  if (session.error) return { error: session.error, status: session.status };
  const { emp } = session;

  const target = await resolveEmployeeTarget(admin, rawId);
  const isSuperadmin = !!emp.is_superadmin;
  const isSelf = !!target?.accountId && target.accountId === emp.id;
  if (!target || (!isSuperadmin && !isSelf)) {
    return { error: 'Karyawan tidak ditemukan.', status: 404 };
  }
  return { emp, target, isSuperadmin, isSelf };
}

// Superadmin boleh menghapus semuanya. Karyawan hanya dokumen yang ia unggah
// sendiri (uploaded_by = akunnya) dan bukan dokumen kontrak. Baris lama dari
// HR (uploaded_by kosong) otomatis tidak bisa dihapus karyawan.
export function bolehHapusDokumen({ row, emp, isSuperadmin }) {
  if (isSuperadmin) return true;
  if (isDokumenKontrak(row)) return false;
  return !!row.uploaded_by && row.uploaded_by === emp.id;
}

export function tipeKonten(fileName) {
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  return TIPE_KONTEN[ext] || null;
}

// Bentuk baris untuk client: tanpa drive_file_id / file_path (tidak perlu
// bocor), judul seragam untuk dua skema lama, dan can_delete dihitung server.
export function normalisasiDokumen(row, { emp, isSuperadmin }) {
  const judul = row.nama_dokumen || row.jenis || 'Dokumen';
  const label = row.label && !judul.includes(row.label) ? row.label : null;
  return {
    id: row.id,
    judul,
    keterangan: label,
    file_name: row.file_name || '-',
    uploaded_at: row.uploaded_at || row.created_at || null,
    kontrak: isDokumenKontrak(row),
    can_delete: bolehHapusDokumen({ row, emp, isSuperadmin }),
  };
}

export function urutkanTerbaru(rows) {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.uploaded_at || a.created_at || 0).getTime();
    const tb = new Date(b.uploaded_at || b.created_at || 0).getTime();
    return tb - ta;
  });
}
