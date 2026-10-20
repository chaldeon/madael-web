import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { PENDING_QUEUE_MODULES, isModuleGranted } from '@/lib/employeeModules';
import { SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN } from '@/lib/leave';

// Satu query count per modul antrean persetujuan. Kuncinya = key modul di
// MODULE_REGISTRY (flag pendingQueue). Tiap fungsi menerima query builder
// `select(..., { count: 'exact', head: true })` dan emp yang sedang login.
//
// ownColumn: kolom pemilik pengajuan. Pengajuan milik approver sendiri tidak
// dihitung karena route keputusannya menolak memprosesnya (lihat
// SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN di lib/leave.js), jadi badge tidak
// menjanjikan antrean yang tidak bisa dia kerjakan.
const PENDING_QUERIES = {
  leave_request_admin: { table: 'leave_requests', ownColumn: 'employee_id' },
  overtime_admin: { table: 'overtime_requests', ownColumn: 'employee_id' },
  reimbursement_admin: { table: 'reimbursement_requests', ownColumn: 'employee_id' },
  profile_admin: { table: 'profile_change_requests', ownColumn: 'employee_id' },
  // Koreksi absensi: hanya pengajuan mandiri karyawan (requested_by terisi),
  // sama dengan route approve. Route itu tidak punya cek milik-sendiri.
  absensi_admin: {
    table: 'attendance_corrections',
    extra: (q) => q.not('requested_by', 'is', null),
  },
};

// GET /api/dashboard/pending-counts
// Jumlah pengajuan berstatus 'pending' untuk modul approval yang boleh diakses
// user (dicek per modul lewat isModuleGranted — superadmin tetap tidak
// bypass EXPLICIT_ONLY_MODULES, dan absensi_admin khusus superadmin).
// Respons: { counts: { <module_key>: number } } — hanya key yang dia punya
// aksesnya. User tanpa modul approval mendapat { counts: {} }, bukan 403,
// karena dashboard memanggil ini untuk semua karyawan yang punya modul HRIS.
// Count yang gagal dihilangkan dari respons (badge tidak tampil) dan dicatat
// di log; satu tabel bermasalah tidak boleh mematikan badge lainnya.
export async function GET() {
  try {
    const session = await getSessionEmployee('id, status, is_superadmin');
    if (session.error) return NextResponse.json({ error: session.error }, { status: session.status });
    const { emp } = session;

    const admin = createAdminClient();
    const { data: mods, error: modsError } = await admin
      .from('employee_modules')
      .select('module_name')
      .eq('employee_id', emp.id)
      .in('module_name', PENDING_QUEUE_MODULES);
    if (modsError) {
      console.error('Muat modul untuk badge dashboard error:', modsError);
      return NextResponse.json({ error: 'Gagal memuat.' }, { status: 500 });
    }

    const moduleKeys = (mods || []).map((m) => m.module_name);
    const keys = PENDING_QUEUE_MODULES.filter(
      (key) =>
        PENDING_QUERIES[key] &&
        isModuleGranted({ isSuperadmin: !!emp.is_superadmin, moduleKeys, key })
    );

    const excludeOwn = !(SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN && emp.is_superadmin);

    const results = await Promise.all(
      keys.map(async (key) => {
        const { table, ownColumn, extra } = PENDING_QUERIES[key];
        let query = admin
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending');
        if (ownColumn && excludeOwn) query = query.neq(ownColumn, emp.id);
        if (extra) query = extra(query);

        const { count, error } = await query;
        if (error) {
          console.error(`Hitung antrean ${key} error:`, error);
          return null;
        }
        return [key, count || 0];
      })
    );

    return NextResponse.json(
      { counts: Object.fromEntries(results.filter(Boolean)) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('Pending counts dashboard error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
