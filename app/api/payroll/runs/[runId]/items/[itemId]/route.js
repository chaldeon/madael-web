import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { idBentukValid } from '@/lib/payrollRunServer';
import { bacaNominalManual, hitungUlangItem } from '@/lib/payroll/runItem';

// PATCH /api/payroll/runs/[runId]/items/[itemId]
//   body: { overtime?, insentif?, kompensasi? }
//
// Menyimpan input manual satu item run dan menghitung ulang PPh21 + THP DI
// SERVER (rumus di lib/payroll/runItem.js). Dulu browser menghitung lalu
// meng-update payroll_run_items langsung, sehingga nilai uang bisa dikirim
// bebas dan run yang sudah Approved masih bisa diubah. Sekarang:
//  - nominal divalidasi (angka, tidak negatif, batas wajar);
//  - run Approved ditolak (409), termasuk bila berubah menjadi Approved
//    tepat saat item disimpan;
//  - perubahan dicatat di activity log dengan nilai sebelum/sesudah.
export async function PATCH(request, { params }) {
  try {
    const { runId, itemId } = await params;
    if (!idBentukValid(runId) || !idBentukValid(itemId)) {
      return NextResponse.json({ error: 'Item payroll run tidak ditemukan.' }, { status: 404 });
    }

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => ({}));
    const manual = {};
    for (const [field, label] of [['overtime', 'Overtime'], ['insentif', 'Insentif'], ['kompensasi', 'Kompensasi']]) {
      const parsed = bacaNominalManual(body?.[field], label);
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
      manual[field] = parsed.value;
    }

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
    if (run.status === 'Approved') {
      return NextResponse.json(
        { error: 'Payroll run yang sudah Approved tidak bisa diubah.', status: run.status },
        { status: 409 }
      );
    }

    const { data: item, error: itemError } = await admin
      .from('payroll_run_items')
      .select('id, payroll_run_id, gaji_pokok, allowance, penalty, overtime, insentif, kompensasi, pph21, take_home_pay, employees_master ( jkk_rate, status_ptkp )')
      .eq('id', itemId)
      .eq('payroll_run_id', runId)
      .maybeSingle();
    if (itemError) {
      if (itemError.code === '22P02') {
        return NextResponse.json({ error: 'Item payroll run tidak ditemukan.' }, { status: 404 });
      }
      return NextResponse.json(
        { error: `Gagal memuat item payroll run: ${friendlyError(itemError, 'terjadi kesalahan pada server.', { context: 'Muat item payroll run' })}` },
        { status: 500 }
      );
    }
    if (!item) {
      return NextResponse.json({ error: 'Item payroll run tidak ditemukan.' }, { status: 404 });
    }

    const payload = hitungUlangItem(item, item.employees_master, manual);

    const { data: updated, error: updateError } = await admin
      .from('payroll_run_items')
      .update(payload)
      .eq('id', itemId)
      .eq('payroll_run_id', runId)
      .select('id')
      .maybeSingle();
    if (updateError) {
      return NextResponse.json(
        { error: `Gagal menyimpan item: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Simpan item payroll run' })}` },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json({ error: 'Item payroll run tidak ditemukan.' }, { status: 404 });
    }

    // Cek ulang: kalau run baru saja di-Approve di antara pengecekan dan
    // penyimpanan, slip bisa sudah dibuat dari angka lama. Beri tahu admin.
    const { data: runSesudah } = await admin
      .from('payroll_runs')
      .select('status')
      .eq('id', runId)
      .maybeSingle();
    if (runSesudah?.status === 'Approved') {
      return NextResponse.json(
        {
          error: 'Payroll run baru saja di-Approve. Perubahan ini mungkin tidak ikut ke slip gaji — muat ulang halaman dan periksa slip.',
          status: 'Approved',
        },
        { status: 409 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_item_payroll_run',
      targetTable: 'payroll_run_items',
      targetId: itemId,
      detail: {
        run_id: runId,
        periode: run.periode,
        sebelum: {
          overtime: item.overtime,
          insentif: item.insentif,
          kompensasi: item.kompensasi,
          pph21: item.pph21,
          take_home_pay: item.take_home_pay,
        },
        sesudah: payload,
      },
    });

    return NextResponse.json({ success: true, item: payload });
  } catch (err) {
    console.error('Ubah item payroll run error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
