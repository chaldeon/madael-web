import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivities } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { idBentukValid } from '@/lib/payrollRunServer';
import { hitungUlangItem } from '@/lib/payroll/runItem';
import { hitungSaranLembur } from '@/lib/payroll/overtimeSuggestion';

const PARALEL = 10;

// PATCH /api/payroll/runs/[runId]/items
//   body: { sumber: 'lembur_disetujui', konfirmasiTimpa?: boolean }
//
// Menyimpan Overtime SEMUA item run sekaligus dari lembur yang sudah disetujui
// pada periode run (tombol "Isi dari lembur disetujui"). Nominal dihitung
// server sendiri (lib/payroll/overtimeSuggestion.js) — body TIDAK membawa
// angka — lalu PPh21 + THP tiap item dihitung ulang dengan rumus yang sama
// dengan PATCH per item (lib/payroll/runItem.js).
//
// Aturan (opsi paling aman):
//  - hanya item yang punya lembur disetujui yang disentuh; item lain tidak
//    diubah, tidak di-nol-kan;
//  - Insentif/Kompensasi memakai nilai TERSIMPAN di item (draf layar tidak ikut);
//  - bila ada item yang Overtime-nya sudah terisi (> 0) dan akan berubah, server
//    menjawab 409 NEEDS_CONFIRM_OVERWRITE TANPA menulis apa pun; ulangi dengan
//    konfirmasiTimpa: true setelah admin setuju;
//  - run Approved ditolak (409), juga bila berubah jadi Approved saat proses;
//  - tiap item yang berubah dicatat di activity log (sebelum/sesudah), sehingga
//    nilai lama bisa dipulihkan manual; kegagalan satu item tidak membatalkan
//    yang lain dan dilaporkan di `gagal` (aman diulang: hasilnya sama).
export async function PATCH(request, { params }) {
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

    const body = await request.json().catch(() => ({}));
    if (body?.sumber !== 'lembur_disetujui') {
      return NextResponse.json({ error: 'Sumber pengisian tidak dikenal.' }, { status: 400 });
    }
    const konfirmasiTimpa = body?.konfirmasiTimpa === true;

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

    const saran = await hitungSaranLembur(admin, run.periode);
    if (saran.error) {
      return NextResponse.json({ error: saran.error }, { status: 500 });
    }

    const { data: items, error: itemsError } = await fetchAllRows(() =>
      admin
        .from('payroll_run_items')
        .select('id, payroll_run_id, employee_master_id, gaji_pokok, allowance, penalty, overtime, insentif, kompensasi, pph21, take_home_pay, employees_master ( jkk_rate, status_ptkp )')
        .eq('payroll_run_id', runId)
    );
    if (itemsError) {
      return NextResponse.json(
        { error: `Gagal memuat item payroll run: ${friendlyError(itemsError, 'terjadi kesalahan pada server.', { context: 'Muat item payroll run' })}` },
        { status: 500 }
      );
    }

    const itemByMasterId = new Map((items || []).map((i) => [i.employee_master_id, i]));

    // Susun perubahan. Karyawan klien lain tidak dihitung sebagai "tanpa item".
    const perubahan = [];
    let tidakBerubah = 0;
    let tanpaItem = 0;
    for (const sug of saran.suggestions) {
      const item = itemByMasterId.get(sug.employee_master_id);
      if (!item) {
        if (sug.client_id === run.client_id) tanpaItem += 1;
        continue;
      }
      if (Number(item.overtime) === sug.nominal) {
        tidakBerubah += 1;
        continue;
      }
      const payload = hitungUlangItem(item, item.employees_master, {
        overtime: sug.nominal,
        insentif: item.insentif,
        kompensasi: item.kompensasi,
      });
      perubahan.push({ item, payload, timpa: (Number(item.overtime) || 0) > 0 });
    }

    const jumlahTimpa = perubahan.filter((p) => p.timpa).length;
    if (jumlahTimpa > 0 && !konfirmasiTimpa) {
      return NextResponse.json(
        {
          error: `${jumlahTimpa} employee sudah punya nilai Overtime yang akan diganti.`,
          code: 'NEEDS_CONFIRM_OVERWRITE',
          timpa: jumlahTimpa,
          berubah: perubahan.length,
        },
        { status: 409 }
      );
    }

    // Simpan per item (maks. PARALEL sekaligus).
    const berhasil = [];
    const gagal = [];
    for (let i = 0; i < perubahan.length; i += PARALEL) {
      const chunk = perubahan.slice(i, i + PARALEL);
      const hasil = await Promise.all(
        chunk.map(async (p) => {
          const { data: updated, error: updateError } = await admin
            .from('payroll_run_items')
            .update(p.payload)
            .eq('id', p.item.id)
            .eq('payroll_run_id', runId)
            .select('id')
            .maybeSingle();
          if (updateError) {
            console.error('Isi lembur batch — simpan item error:', updateError);
            return { p, ok: false };
          }
          return { p, ok: !!updated };
        })
      );
      for (const h of hasil) (h.ok ? berhasil : gagal).push(h.p);
    }

    if (perubahan.length > 0 && berhasil.length === 0) {
      return NextResponse.json(
        { error: 'Gagal menyimpan Overtime ke item payroll run. Coba lagi.' },
        { status: 500 }
      );
    }

    // Cek ulang: kalau run baru saja di-Approve saat proses, slip bisa sudah
    // dibuat dari angka lama. Beri tahu admin (sama seperti PATCH per item).
    const { data: runSesudah } = await admin
      .from('payroll_runs')
      .select('status')
      .eq('id', runId)
      .maybeSingle();

    await logActivities(
      admin,
      berhasil.map(({ item, payload }) => ({
        userId: emp.id,
        aksi: 'ubah_item_payroll_run',
        targetTable: 'payroll_run_items',
        targetId: item.id,
        detail: {
          run_id: runId,
          periode: run.periode,
          sumber: 'isi_dari_lembur_disetujui',
          sebelum: {
            overtime: item.overtime,
            insentif: item.insentif,
            kompensasi: item.kompensasi,
            pph21: item.pph21,
            take_home_pay: item.take_home_pay,
          },
          sesudah: payload,
        },
      }))
    );

    if (runSesudah?.status === 'Approved') {
      return NextResponse.json(
        {
          error: 'Payroll run baru saja di-Approve. Perubahan ini mungkin tidak ikut ke slip gaji — muat ulang halaman dan periksa slip.',
          status: 'Approved',
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      success: true,
      periode: run.periode,
      diterapkan: berhasil.length,
      timpa: berhasil.filter((p) => p.timpa).length,
      tidak_berubah: tidakBerubah,
      tanpa_item: tanpaItem,
      tidak_terhubung: saran.tidakTerhubung.map((t) => ({ nama: t.nama })),
      gagal: gagal.length,
      items: berhasil.map(({ item, payload }) => ({ id: item.id, ...payload })),
    });
  } catch (err) {
    console.error('Isi lembur batch payroll run error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
