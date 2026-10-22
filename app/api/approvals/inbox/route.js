import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { MODULE_REGISTRY } from '@/lib/employeeModules';
import { PENDING_QUERIES, applyPendingFilters } from '@/lib/pendingQueue';
import { getApproverContext } from '@/lib/pendingQueueServer';

// Maksimum baris per modul. Yang ditampilkan adalah yang PALING LAMA menunggu;
// sisanya tetap bisa dibuka di halaman modul (total sebenarnya ada di `total`).
const MAKS_BARIS_PER_MODUL = 100;

const HREF_BY_KEY = Object.fromEntries(MODULE_REGISTRY.map((m) => [m.key, m.href]));

// GET /api/approvals/inbox
// Antrean persetujuan lintas modul untuk Inbox Persetujuan: pengajuan 'pending'
// dari modul approval yang boleh diakses user. Hak akses dan filter
// pemilik-sendiri memakai definisi yang sama dengan badge dashboard
// (lib/pendingQueue.js + lib/pendingQueueServer.js). Route ini hanya MEMBACA —
// keputusan (approve/reject) tetap lewat route keputusan tiap modul.
// Respons: { groups: [{ key, jenis, href, total, shown }], items: [{ id, module,
// jenis, pemohon, ringkasan, diajukan, href }] }. Modul yang gagal dimuat masuk
// `failed` (nama jenis) dan tidak mematikan modul lain.
export async function GET() {
  try {
    const admin = createAdminClient();
    const ctx = await getApproverContext(admin);
    if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { emp, keys, excludeOwn } = ctx;

    if (keys.length === 0) {
      return NextResponse.json({ error: 'Anda tidak punya akses ke fitur ini.' }, { status: 403 });
    }

    const results = await Promise.all(
      keys.map(async (key) => {
        const config = PENDING_QUERIES[key];
        const query = applyPendingFilters(
          admin
            .from(config.table)
            .select(`id, employee_id, created_at, ${config.select}`, { count: 'exact' }),
          config,
          { empId: emp.id, excludeOwn }
        )
          .order('created_at', { ascending: true })
          .limit(MAKS_BARIS_PER_MODUL);

        const { data, count, error } = await query;
        if (error) {
          console.error(`Muat antrean inbox ${key} error:`, error);
          return { key, config, error: true };
        }
        return { key, config, rows: data || [], total: count ?? (data || []).length };
      })
    );

    const okResults = results.filter((r) => !r.error);

    // Nama pemohon: satu query untuk semua id (tabel employees, bukan master).
    const ids = [...new Set(okResults.flatMap((r) => r.rows.map((row) => row.employee_id)))];
    const namaById = {};
    if (ids.length > 0) {
      const { data: emps, error: empError } = await admin
        .from('employees')
        .select('id, nama')
        .in('id', ids);
      if (empError) {
        console.error('Muat nama pemohon inbox error:', empError);
        return NextResponse.json({ error: 'Gagal memuat.' }, { status: 500 });
      }
      (emps || []).forEach((e) => { namaById[e.id] = e.nama; });
    }

    const groups = okResults.map((r) => ({
      key: r.key,
      jenis: r.config.jenis,
      href: HREF_BY_KEY[r.key] || '/employee/dashboard',
      total: r.total,
      shown: r.rows.length,
    }));

    const items = okResults.flatMap((r) =>
      r.rows.map((row) => ({
        id: `${r.key}:${row.id}`,
        module: r.key,
        jenis: r.config.jenis,
        pemohon: namaById[row.employee_id] || '—',
        ringkasan: r.config.ringkas(row),
        diajukan: row.created_at,
        href: HREF_BY_KEY[r.key] || '/employee/dashboard',
      }))
    );

    const failed = results.filter((r) => r.error).map((r) => r.config.jenis);

    return NextResponse.json(
      { groups, items, failed },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('Inbox persetujuan error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
