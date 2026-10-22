import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { PENDING_QUERIES, applyPendingFilters } from '@/lib/pendingQueue';
import { getApproverContext } from '@/lib/pendingQueueServer';

// GET /api/dashboard/pending-counts
// Jumlah pengajuan berstatus 'pending' untuk modul approval yang boleh diakses
// user (dicek per modul lewat isModuleGranted — superadmin tetap tidak
// bypass EXPLICIT_ONLY_MODULES, dan absensi_admin khusus superadmin).
// Definisi antrean (tabel, filter pemilik-sendiri) ada di lib/pendingQueue.js,
// dipakai bersama Inbox Persetujuan supaya badge dan isi inbox selalu sama.
// Respons: { counts: { <module_key>: number } } — hanya key yang dia punya
// aksesnya. User tanpa modul approval mendapat { counts: {} }, bukan 403,
// karena dashboard memanggil ini untuk semua karyawan yang punya modul HRIS.
// Count yang gagal dihilangkan dari respons (badge tidak tampil) dan dicatat
// di log; satu tabel bermasalah tidak boleh mematikan badge lainnya.
export async function GET() {
  try {
    const admin = createAdminClient();
    const ctx = await getApproverContext(admin);
    if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { emp, keys, excludeOwn } = ctx;

    const results = await Promise.all(
      keys.map(async (key) => {
        const config = PENDING_QUERIES[key];
        const query = applyPendingFilters(
          admin.from(config.table).select('id', { count: 'exact', head: true }),
          config,
          { empId: emp.id, excludeOwn }
        );

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
