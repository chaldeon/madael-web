import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { idBentukValid, loadMastersByClient, pisahAkunNonaktif, buildSnapshots } from '@/lib/payrollRunServer';

// POST /api/payroll/runs/[runId]/sync
//
// Menambahkan employee yang baru masuk Payroll Manager SETELAH run dibuat
// (payroll_run_items adalah snapshot sekali jalan). Hanya untuk run yang belum
// Approved. Snapshot dihitung di server dengan logika yang sama seperti saat
// run dibuat; akun absensi Nonaktif tidak ikut ditambahkan (aturan yang sama
// dengan pembuatan run).
export async function POST(request, { params }) {
  try {
    const { runId } = await params;
    if (!idBentukValid(runId)) {
      return NextResponse.json({ error: 'Payroll run tidak ditemukan.' }, { status: 404 });
    }

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const { data: run, error: runError } = await admin
      .from('payroll_runs')
      .select('id, client_id, periode, status')
      .eq('id', runId)
      .maybeSingle();
    if (runError) {
      if (runError.code === '22P02') {
        return NextResponse.json({ error: 'Payroll run tidak ditemukan.' }, { status: 404 });
      }
      return NextResponse.json(
        { error: `Gagal memuat payroll run: ${friendlyError(runError, 'terjadi kesalahan pada server.', { context: 'Muat payroll run' })}` },
        { status: 500 }
      );
    }
    if (!run) {
      return NextResponse.json({ error: 'Payroll run tidak ditemukan.' }, { status: 404 });
    }
    if (run.status === 'Approved') {
      return NextResponse.json(
        { error: 'Payroll run yang sudah Approved tidak bisa diubah.', status: run.status },
        { status: 409 }
      );
    }

    const { data: masters, error: mastersError } = await loadMastersByClient(admin, run.client_id);
    if (mastersError) {
      return NextResponse.json(
        { error: `Gagal cek employee baru: ${friendlyError(mastersError, 'terjadi kesalahan pada server.', { context: 'Muat employee klien' })}` },
        { status: 500 }
      );
    }

    const { data: existingItems, error: itemsError } = await fetchAllRows(() =>
      admin.from('payroll_run_items').select('employee_master_id').eq('payroll_run_id', runId)
    );
    if (itemsError) {
      return NextResponse.json(
        { error: `Gagal memuat item payroll run: ${friendlyError(itemsError, 'terjadi kesalahan pada server.', { context: 'Muat item payroll run' })}` },
        { status: 500 }
      );
    }

    const sudahAda = new Set((existingItems || []).map((i) => i.employee_master_id));
    const baru = (masters || []).filter((m) => !sudahAda.has(m.id));
    if (baru.length === 0) {
      return NextResponse.json({
        success: true,
        added: 0,
        note: 'Tidak ada employee baru — semua employee klien ini sudah ada di run ini.',
      });
    }

    const split = await pisahAkunNonaktif(admin, baru);
    if (split.error) {
      return NextResponse.json(
        { error: `Gagal cek status akun absensi: ${friendlyError(split.error, 'terjadi kesalahan pada server.', { context: 'Cek akun absensi' })}` },
        { status: 500 }
      );
    }
    const { aktif, dilewati } = split;
    const catatanDilewati = dilewati.length > 0
      ? ` ${dilewati.length} employee dilewati karena akun absensinya Nonaktif: ${dilewati.map((d) => d.nama).join(', ')}.`
      : '';

    if (aktif.length === 0) {
      return NextResponse.json({
        success: true,
        added: 0,
        note: `Tidak ada employee baru yang bisa ditambahkan.${catatanDilewati}`,
      });
    }

    const snapshots = await buildSnapshots(admin, aktif, run.periode);
    const { error: insertError } = await admin
      .from('payroll_run_items')
      .insert(snapshots.map((s) => ({ ...s, payroll_run_id: run.id })));
    if (insertError) {
      // 23505 = unique violation: sinkronisasi lain baru saja menambahkan employee yang sama.
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'Item run baru saja berubah. Muat ulang halaman lalu coba lagi.' },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: `Gagal tambah employee baru ke run: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Tambah item payroll run' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'sync_payroll_run',
      targetTable: 'payroll_runs',
      targetId: run.id,
      detail: { periode: run.periode, ditambahkan: snapshots.length, dilewati_nonaktif: dilewati.map((d) => d.nama) },
    });

    return NextResponse.json({
      success: true,
      added: snapshots.length,
      note: `${snapshots.length} employee baru berhasil ditambahkan ke run ini.${catatanDilewati}`,
    });
  } catch (err) {
    console.error('Sync payroll run error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
