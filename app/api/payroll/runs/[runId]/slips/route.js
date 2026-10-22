import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployees } from '@/lib/notify';
import { friendlyError } from '@/lib/errorMessage';
import { periodeLabel } from '@/lib/payrollRunConfig';
import { RUN_ITEM_SELECT, generateSlipsForRun, ringkasanGenerateSlip } from '@/lib/payrollServer';

// POST /api/payroll/runs/[runId]/slips
//
// "Generate ulang slip": melengkapi slip yang belum ada untuk run yang sudah
// Approved (mis. proses generate saat Approve terputus atau ada item yang
// gagal). Idempoten dan TIDAK menimpa slip yang sudah ada — hanya membuat
// yang belum ada dan menghubungkan slip employee+periode yang sudah ada tapi
// belum tertaut ke item run.
export async function POST(request, { params }) {
  try {
    const { runId } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const { data: run, error: runError } = await admin
      .from('payroll_runs')
      .select('id, periode, status')
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
    if (run.status !== 'Approved') {
      return NextResponse.json(
        { error: 'Slip hanya bisa digenerate untuk payroll run yang sudah Approved.', status: run.status },
        { status: 409 }
      );
    }

    const { data: items, error: itemsError } = await admin
      .from('payroll_run_items')
      .select(RUN_ITEM_SELECT)
      .eq('payroll_run_id', runId);
    if (itemsError) {
      return NextResponse.json(
        { error: `Gagal memuat item payroll run: ${friendlyError(itemsError, 'terjadi kesalahan pada server.', { context: 'Muat item payroll run' })}` },
        { status: 500 }
      );
    }

    const slips = await generateSlipsForRun(admin, {
      periode: run.periode,
      items: items || [],
      overwriteExisting: false,
    });

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'generate_ulang_slip_payroll',
      targetTable: 'payroll_runs',
      targetId: runId,
      detail: {
        periode: run.periode,
        dibuat: slips.created,
        dihubungkan: slips.linked,
        dilewati: slips.skipped,
        gagal: slips.errors.length,
      },
    });

    // Hanya employee yang slipnya BARU dibuat yang perlu diberi tahu.
    if (slips.createdEmployeeIds.length > 0) {
      await notifyEmployees(admin, {
        userIds: slips.createdEmployeeIds,
        tipe: 'payroll_approved',
        pesan: `Payslip periode ${periodeLabel(run.periode)} sudah disetujui dan bisa dilihat.`,
        link: '/employee/payslip',
      });
    }

    return NextResponse.json({ success: true, slips: { ...slips, note: ringkasanGenerateSlip(slips) } });
  } catch (err) {
    console.error('Generate ulang slip payroll error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
