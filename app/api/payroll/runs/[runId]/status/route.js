import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployees } from '@/lib/notify';
import { NOTIFICATION_EVENTS } from '@/lib/notificationEvents';
import { friendlyError } from '@/lib/errorMessage';
import {
  PAYROLL_RUN_STATUSES,
  canTransitionPayrollRun,
  pesanTransisiPayrollTidakValid,
} from '@/lib/payrollRun';
import { RUN_ITEM_SELECT, generateSlipsForRun, ringkasanGenerateSlip } from '@/lib/payrollServer';

// PATCH /api/payroll/runs/[runId]/status   body: { status, confirmIncomplete? }
//
// Satu-satunya jalan mengubah status Payroll Run. Dulu browser meng-update
// payroll_runs langsung, lalu menggenerate slip dalam loop di tab yang sama —
// kalau tab ditutup di tengah jalan, run sudah "Approved" tetapi slip hanya
// sebagian, dan log/notifikasi ikut terlewat. Sekarang:
//  - transisi divalidasi (lib/payrollRun.js), update bersyarat pada status
//    yang dibaca (dua admin tidak saling menimpa), updated_by diisi dari sesi;
//  - generate slip berjalan di server dalam request ini dan idempoten; kalau
//    ada yang gagal/terputus, admin memakai "Generate ulang slip"
//    (POST /api/payroll/runs/[runId]/slips);
//  - activity log dan notifikasi dicatat server-side.
//
// Penegakan penuh juga butuh trigger DB yang melarang browser mengubah
// payroll_runs.status langsung — lihat
// supabase/migrations/20261022_payroll_approval_atomik.sql.
export async function PATCH(request, { params }) {
  try {
    const { runId } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => ({}));
    const target = typeof body?.status === 'string' ? body.status : '';
    if (!PAYROLL_RUN_STATUSES.includes(target)) {
      return NextResponse.json({ error: 'Status tidak valid.' }, { status: 400 });
    }

    const { data: run, error: runError } = await admin
      .from('payroll_runs')
      .select('id, periode, status')
      .eq('id', runId)
      .maybeSingle();
    if (runError) {
      // 22P02 = id bukan format yang valid untuk kolom id
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

    if (!canTransitionPayrollRun(run.status, target)) {
      return NextResponse.json(
        { error: pesanTransisiPayrollTidakValid(run.status, target), status: run.status },
        { status: 409 }
      );
    }

    // Prasyarat Approve: ada item, dan item dengan data belum lengkap
    // (PPh21/BPJS Rp0) hanya lolos kalau admin sudah mengonfirmasi.
    let items = [];
    if (target === 'Approved') {
      const { data: itemRows, error: itemsError } = await admin
        .from('payroll_run_items')
        .select(RUN_ITEM_SELECT)
        .eq('payroll_run_id', runId);
      if (itemsError) {
        return NextResponse.json(
          { error: `Gagal memuat item payroll run: ${friendlyError(itemsError, 'terjadi kesalahan pada server.', { context: 'Muat item payroll run' })}` },
          { status: 500 }
        );
      }
      items = itemRows || [];
      if (items.length === 0) {
        return NextResponse.json({ error: 'Payroll run belum punya item, tidak bisa di-Approve.' }, { status: 409 });
      }
      const incompleteCount = items.filter((i) => i.incomplete).length;
      if (incompleteCount > 0 && body.confirmIncomplete !== true) {
        return NextResponse.json(
          {
            error: `${incompleteCount} employee punya PPh21/BPJS Rp0 karena data belum lengkap. Konfirmasi dulu untuk tetap Approve.`,
            code: 'INCOMPLETE_NEEDS_CONFIRM',
          },
          { status: 409 }
        );
      }
    }

    // Update bersyarat: hanya kalau status di DB masih sama dengan yang dibaca.
    const { data: updated, error: updateError } = await admin
      .from('payroll_runs')
      .update({ status: target, updated_by: emp.id, updated_at: new Date().toISOString() })
      .eq('id', runId)
      .eq('status', run.status)
      .select()
      .maybeSingle();
    if (updateError) {
      return NextResponse.json(
        { error: `Gagal menyimpan status: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Ubah status payroll run' })}` },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'Status payroll run baru saja berubah. Muat ulang halaman lalu coba lagi.' },
        { status: 409 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_status_payroll',
      targetTable: 'payroll_runs',
      targetId: runId,
      detail: { periode: run.periode, status_sebelum: run.status, status_sesudah: target },
    });

    if (target !== 'Approved') {
      return NextResponse.json({ success: true, run: updated });
    }

    const slips = await generateSlipsForRun(admin, {
      periode: run.periode,
      items,
      overwriteExisting: true,
    });
    await logActivity(admin, {
      userId: emp.id,
      aksi: 'generate_slip_payroll',
      targetTable: 'payroll_runs',
      targetId: runId,
      detail: {
        periode: run.periode,
        dibuat: slips.created,
        diperbarui: slips.updated,
        dihubungkan: slips.linked,
        dilewati: slips.skipped,
        gagal: slips.errors.length,
      },
    });

    // Notifikasi payroll_approved disusun dari record di DB (sama dengan event
    // yang dulu dipicu browser lewat /api/notifications/dispatch).
    try {
      const built = await NOTIFICATION_EVENTS.payroll_approved.build({ admin, emp, id: runId });
      if (built?.to?.userIds) {
        await notifyEmployees(admin, {
          userIds: built.to.userIds,
          tipe: built.tipe,
          pesan: built.pesan,
          link: built.link,
        });
      }
    } catch (err) {
      console.error('Notifikasi payroll_approved error:', err);
    }

    return NextResponse.json({
      success: true,
      run: updated,
      slips: { ...slips, note: ringkasanGenerateSlip(slips) },
    });
  } catch (err) {
    console.error('Ubah status payroll run error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
