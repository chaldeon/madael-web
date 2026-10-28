import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import {
  PERIODE_REGEX,
  idBentukValid,
  loadMastersByClient,
  pisahAkunNonaktif,
  buildSnapshots,
} from '@/lib/payrollRunServer';

// POST /api/payroll/runs   body: { client_id, periode: 'YYYY-MM', lewati_nonaktif? }
//
// Satu-satunya jalan membuat Payroll Run. Dulu browser meng-insert payroll_runs,
// menghitung snapshot (PPh21/BPJS/THP) sendiri, lalu meng-insert item dalam
// langkah terpisah — kalau langkah kedua gagal atau tab ditutup, run tertinggal
// kosong, dan angka uang berasal dari klien. Sekarang:
//  - hak modul 'payroll' dicek, klien dan periode divalidasi;
//  - satu run per klien + periode (409 RUN_SUDAH_ADA kalau sudah ada);
//  - snapshot dihitung di server dari data employees_master di DB;
//  - kalau item gagal disimpan, run yang baru dibuat dihapus lagi (tidak ada
//    run setengah jadi);
//  - karyawan dengan akun absensi Nonaktif butuh konfirmasi eksplisit
//    (409 NONAKTIF_PERLU_KONFIRMASI, kirim ulang dengan lewati_nonaktif: true);
//  - activity log dicatat dari server.
//
// Penegakan penuh (satu run per klien+periode di level DB, dan browser tidak
// boleh menulis payroll_runs/payroll_run_items) butuh migrasi
// supabase/migrations/20261028_payroll_run_server_only.sql.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => ({}));
    const clientId = typeof body?.client_id === 'string' ? body.client_id : '';
    const periode = typeof body?.periode === 'string' ? body.periode : '';
    if (!idBentukValid(clientId)) {
      return NextResponse.json({ error: 'Klien tidak valid.' }, { status: 400 });
    }
    if (!PERIODE_REGEX.test(periode)) {
      return NextResponse.json({ error: 'Periode tidak valid (format YYYY-MM).' }, { status: 400 });
    }

    const { data: company, error: companyError } = await admin
      .from('companies')
      .select('id, nama_perusahaan')
      .eq('id', clientId)
      .maybeSingle();
    if (companyError) {
      if (companyError.code === '22P02') {
        return NextResponse.json({ error: 'Klien tidak ditemukan.' }, { status: 404 });
      }
      return NextResponse.json(
        { error: `Gagal memuat klien: ${friendlyError(companyError, 'terjadi kesalahan pada server.', { context: 'Muat klien payroll' })}` },
        { status: 500 }
      );
    }
    if (!company) {
      return NextResponse.json({ error: 'Klien tidak ditemukan.' }, { status: 404 });
    }

    const duplikat = async () => {
      const { data } = await admin
        .from('payroll_runs')
        .select('id')
        .eq('client_id', clientId)
        .eq('periode', periode)
        .limit(1);
      return data?.[0] || null;
    };
    const jawabDuplikat = (existing) =>
      NextResponse.json(
        {
          error: `Payroll run untuk klien "${company.nama_perusahaan}" pada periode ${periode} sudah ada.`,
          code: 'RUN_SUDAH_ADA',
          run_id: existing?.id || null,
        },
        { status: 409 }
      );

    const existing = await duplikat();
    if (existing) return jawabDuplikat(existing);

    const { data: masters, error: mastersError } = await loadMastersByClient(admin, clientId);
    if (mastersError) {
      return NextResponse.json(
        { error: `Gagal memuat employee klien "${company.nama_perusahaan}": ${friendlyError(mastersError, 'terjadi kesalahan pada server.', { context: 'Muat employee klien' })}` },
        { status: 500 }
      );
    }
    if (!masters || masters.length === 0) {
      return NextResponse.json(
        { error: `Klien "${company.nama_perusahaan}" belum punya employee di Payroll Manager.`, code: 'TIDAK_ADA_EMPLOYEE' },
        { status: 409 }
      );
    }

    const split = await pisahAkunNonaktif(admin, masters);
    if (split.error) {
      return NextResponse.json(
        { error: `Gagal cek status akun absensi: ${friendlyError(split.error, 'terjadi kesalahan pada server.', { context: 'Cek akun absensi' })}` },
        { status: 500 }
      );
    }
    const { aktif, dilewati } = split;

    if (dilewati.length > 0 && body.lewati_nonaktif !== true) {
      return NextResponse.json(
        {
          error: `${dilewati.length} employee punya akun absensi Nonaktif dan akan dilewati. Konfirmasi dulu untuk melanjutkan.`,
          code: 'NONAKTIF_PERLU_KONFIRMASI',
          dilewati: dilewati.map((d) => d.nama),
        },
        { status: 409 }
      );
    }
    if (aktif.length === 0) {
      return NextResponse.json(
        { error: `Semua employee klien "${company.nama_perusahaan}" dilewati (akun Nonaktif) — tidak ada yang bisa dimasukkan ke draft.` },
        { status: 409 }
      );
    }

    const snapshots = await buildSnapshots(admin, aktif, periode);

    const { data: run, error: runError } = await admin
      .from('payroll_runs')
      .insert([{ client_id: clientId, periode, status: 'Draft' }])
      .select()
      .single();
    if (runError) {
      // 23505 = unique violation: dua admin membuat run yang sama bersamaan.
      if (runError.code === '23505') return jawabDuplikat(await duplikat());
      return NextResponse.json(
        { error: `Gagal membuat payroll run: ${friendlyError(runError, 'terjadi kesalahan pada server.', { context: 'Buat payroll run' })}` },
        { status: 500 }
      );
    }

    const { error: itemsError } = await admin
      .from('payroll_run_items')
      .insert(snapshots.map((s) => ({ ...s, payroll_run_id: run.id })));
    if (itemsError) {
      // Tidak boleh ada run kosong/setengah jadi: batalkan run yang baru dibuat.
      const { error: rollbackError } = await admin.from('payroll_runs').delete().eq('id', run.id);
      if (rollbackError) console.error('Rollback payroll run gagal:', rollbackError);
      return NextResponse.json(
        {
          error: `Gagal menyimpan item payroll run: ${friendlyError(itemsError, 'terjadi kesalahan pada server.', { context: 'Simpan item payroll run' })}${rollbackError ? ' Run kosong tertinggal — hubungi admin sistem.' : ' Tidak ada data yang tersimpan, silakan coba lagi.'}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'buat_payroll_run',
      targetTable: 'payroll_runs',
      targetId: run.id,
      detail: {
        periode,
        klien: company.nama_perusahaan,
        jumlah_item: snapshots.length,
        dilewati_nonaktif: dilewati.map((d) => d.nama),
      },
    });

    return NextResponse.json({ success: true, run, jumlah_item: snapshots.length }, { status: 201 });
  } catch (err) {
    console.error('Buat payroll run error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
