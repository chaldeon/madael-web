import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { scheduleFieldsFromTemplate } from '@/lib/shifts';
import {
  ambilTemplate, isSafeId, parseEmployeeIds, parseToleransiServer, potong, requireJadwalAdmin,
} from '@/lib/scheduleServer';
import { MAX_TOLERANSI_MENIT } from '@/lib/attendanceStatus';

// POST /api/attendance/schedule/bulk   Khusus superadmin.
//   { mode: 'toleransi', employee_ids, toleransi_menit, client_id? }
//       Set toleransi telat yang sama untuk jadwal KUSTOM yang sudah ada. Jadwal
//       yang tertaut template dilewati (toleransinya diatur di template) dan
//       tidak ada jadwal baru yang dibuat.
//   { mode: 'shift', employee_ids, template_id, client_id?, work_location_id? }
//       Pasang satu template ke banyak karyawan Aktif; yang belum punya jadwal
//       dibuatkan baru. Satu upsert = satu statement, jadi berhasil semua atau tidak.
//
// client_id / work_location_id hanya konteks filter untuk activity log.
// Absensi yang sudah tercatat tidak disentuh (forward-only).
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireJadwalAdmin(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Data tidak valid.' }, { status: 400 });
    }
    if (body.mode !== 'toleransi' && body.mode !== 'shift') {
      return NextResponse.json({ error: 'Aksi massal tidak dikenal.' }, { status: 400 });
    }

    const parsedIds = parseEmployeeIds(body.employee_ids);
    if (parsedIds.error) return NextResponse.json({ error: parsedIds.error }, { status: 400 });
    const { ids } = parsedIds;

    const clientId = isSafeId(body.client_id) ? body.client_id : null;

    if (body.mode === 'toleransi') {
      const toleransi = parseToleransiServer(body.toleransi_menit);
      if (toleransi === null) {
        return NextResponse.json(
          { error: `Toleransi harus bilangan bulat 0–${MAX_TOLERANSI_MENIT} menit.` },
          { status: 400 }
        );
      }

      const diubah = [];
      for (const potongan of potong(ids)) {
        // Hanya jadwal kustom (shift_template_id kosong). Filter ini diterapkan di
        // server supaya klien tidak bisa menyimpangkan jadwal dari template-nya.
        let res = await admin
          .from('work_schedule')
          .update({ toleransi_menit: toleransi })
          .in('employee_id', potongan)
          .is('shift_template_id', null)
          .select();
        // 42703 = kolom shift_template_id belum ada (migrasi shift belum dijalankan):
        // semua jadwal pasti kustom.
        if (res.error?.code === '42703') {
          res = await admin
            .from('work_schedule')
            .update({ toleransi_menit: toleransi })
            .in('employee_id', potongan)
            .select();
        }
        if (res.error) {
          console.error('Toleransi massal error:', res.error);
          const sebagian = diubah.length > 0
            ? ` ${diubah.length} jadwal sudah terubah; ulangi aksi ini untuk menuntaskan sisanya (aman diulang).`
            : '';
          return NextResponse.json(
            { error: `Gagal menerapkan toleransi: ${friendlyError(res.error, 'terjadi kesalahan pada server.', { context: 'Toleransi massal' })}${sebagian}` },
            { status: 500 }
          );
        }
        diubah.push(...(res.data || []));
      }

      await logActivity(admin, {
        userId: access.emp.id,
        aksi: 'set_toleransi_telat_massal',
        targetTable: 'work_schedule',
        detail: { client_id: clientId, toleransi_menit: toleransi, jumlah: diubah.length },
      });
      return NextResponse.json({ success: true, updated: diubah.length, schedules: diubah });
    }

    // mode === 'shift'
    if (!isSafeId(body.template_id)) {
      return NextResponse.json({ error: 'Pilih template shift dulu.' }, { status: 400 });
    }
    const found = await ambilTemplate(admin, body.template_id);
    if (found.error) {
      if (found.cause) console.error('Muat template shift error:', found.cause);
      return NextResponse.json({ error: found.error }, { status: found.status });
    }
    const tpl = found.template;
    if (!tpl.aktif) {
      return NextResponse.json({ error: 'Template shift ini nonaktif, tidak bisa dipasang.' }, { status: 409 });
    }

    // Hanya karyawan Aktif yang ada; id lain dilewati dan dilaporkan.
    const aktif = [];
    for (const potongan of potong(ids)) {
      const { data, error } = await admin
        .from('employees')
        .select('id')
        .in('id', potongan)
        .eq('status', 'Aktif');
      if (error) {
        console.error('Muat karyawan untuk shift massal error:', error);
        return NextResponse.json(
          { error: `Gagal memuat karyawan: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Shift massal' })}` },
          { status: 500 }
        );
      }
      aktif.push(...(data || []).map((r) => r.id));
    }
    if (aktif.length === 0) {
      return NextResponse.json({ error: 'Tidak ada karyawan Aktif di antara yang dipilih.' }, { status: 400 });
    }

    const fields = scheduleFieldsFromTemplate(tpl);
    const { data, error } = await admin
      .from('work_schedule')
      .upsert(aktif.map((id) => ({ employee_id: id, ...fields })), { onConflict: 'employee_id' })
      .select();
    if (error) {
      console.error('Shift massal error:', error);
      return NextResponse.json(
        { error: `Gagal memasang shift: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Shift massal' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: access.emp.id,
      aksi: 'assign_shift_massal',
      targetTable: 'work_schedule',
      targetId: tpl.id,
      detail: {
        shift: tpl.nama,
        client_id: clientId,
        work_location_id: isSafeId(body.work_location_id) ? body.work_location_id : null,
        jumlah: (data || []).length,
        dilewati: ids.length - aktif.length,
      },
    });
    return NextResponse.json({
      success: true,
      updated: (data || []).length,
      skipped: ids.length - aktif.length,
      schedules: data || [],
    });
  } catch (err) {
    console.error('POST jadwal massal error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
