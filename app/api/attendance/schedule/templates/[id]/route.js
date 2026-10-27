import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { scheduleFieldsFromTemplate } from '@/lib/shifts';
import {
  KOLOM_TEMPLATE, ambilTemplate, requireJadwalAdmin, validateTemplateInput,
} from '@/lib/scheduleServer';

const pilihKolom = (row) => Object.fromEntries(KOLOM_TEMPLATE.map((k) => [k, row[k]]));

// PATCH /api/attendance/schedule/templates/[id]
// body: { nama, jam_masuk, jam_pulang, toleransi_menit, hari_kerja, aktif }
// Ubah template, lalu sebarkan ke jadwal semua karyawan yang tertaut. Khusus superadmin.
//
// Dulu dua langkah terpisah dari browser (UPDATE template, lalu UPDATE
// work_schedule), sehingga bisa berhenti separuh jalan. Sekarang penyebaran
// adalah satu statement di server; kalau gagal, template dikembalikan ke nilai
// sebelumnya — jadi hasilnya berubah semua atau tidak sama sekali. Kalau
// pemulihan itu sendiri gagal, pesan error menyuruh simpan ulang (penyebaran
// idempoten).
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireJadwalAdmin(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await request.json().catch(() => null);
    const parsed = validateTemplateInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const found = await ambilTemplate(admin, id);
    if (found.error) {
      if (found.cause) console.error('Muat template shift error:', found.cause);
      return NextResponse.json({ error: found.error }, { status: found.status });
    }
    const before = found.template;

    const { data: updated, error } = await admin
      .from('shift_templates')
      .update(parsed.value)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Nama shift itu sudah dipakai.' }, { status: 409 });
      }
      console.error('Ubah template shift error:', error);
      return NextResponse.json(
        { error: `Gagal menyimpan shift: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Ubah template shift' })}` },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json({ error: 'Template shift tidak ditemukan (mungkin baru saja dihapus).' }, { status: 404 });
    }

    const sync = await admin
      .from('work_schedule')
      .update(scheduleFieldsFromTemplate(updated))
      .eq('shift_template_id', id)
      .select('employee_id');
    if (sync.error) {
      console.error('Sebar template shift error:', sync.error);
      const restore = await admin
        .from('shift_templates')
        .update(pilihKolom(before))
        .eq('id', id);
      if (restore.error) {
        console.error('Pulihkan template shift error:', restore.error);
        return NextResponse.json(
          { error: 'Template tersimpan, tapi gagal menyebar ke jadwal karyawan dan pemulihan otomatis juga gagal. Simpan ulang template yang sama untuk mengulang penyebaran.' },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: `Gagal menyebar ke jadwal karyawan, perubahan dibatalkan: ${friendlyError(sync.error, 'terjadi kesalahan pada server.', { context: 'Sebar template shift' })}` },
        { status: 500 }
      );
    }
    const terdampak = (sync.data || []).length;

    await logActivity(admin, {
      userId: access.emp.id,
      aksi: 'ubah_template_shift',
      targetTable: 'shift_templates',
      targetId: id,
      detail: { before: pilihKolom(before), after: parsed.value, karyawan_terdampak: terdampak },
    });

    return NextResponse.json({ success: true, template: updated, synced: terdampak });
  } catch (err) {
    console.error('PATCH template shift error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

// DELETE /api/attendance/schedule/templates/[id]
// Hapus template shift. Ditolak (409) kalau masih dipakai jadwal karyawan, supaya
// tautan tidak putus diam-diam. Khusus superadmin.
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireJadwalAdmin(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const found = await ambilTemplate(admin, id);
    if (found.error) {
      if (found.cause) console.error('Muat template shift error:', found.cause);
      return NextResponse.json({ error: found.error }, { status: found.status });
    }
    const tpl = found.template;

    const pesanDipakai = (n) =>
      `Shift "${tpl.nama}" masih dipakai${n ? ` ${n} karyawan` : ' karyawan'}. Pindahkan mereka ke shift lain atau jadwal kustom dulu.`;

    const { count, error: countError } = await admin
      .from('work_schedule')
      .select('employee_id', { count: 'exact', head: true })
      .eq('shift_template_id', id);
    if (countError) {
      console.error('Cek pemakaian template shift error:', countError);
      return NextResponse.json(
        { error: `Gagal memeriksa pemakaian shift: ${friendlyError(countError, 'terjadi kesalahan pada server.', { context: 'Cek pemakaian template shift' })}` },
        { status: 500 }
      );
    }
    if ((count || 0) > 0) {
      return NextResponse.json({ error: pesanDipakai(count), dipakai: count }, { status: 409 });
    }

    const { error } = await admin.from('shift_templates').delete().eq('id', id);
    if (error) {
      // 23503: ada jadwal yang menautkan template ini tepat saat dihapus.
      if (error.code === '23503') {
        return NextResponse.json({ error: pesanDipakai(0) }, { status: 409 });
      }
      console.error('Hapus template shift error:', error);
      return NextResponse.json(
        { error: `Gagal menghapus shift: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Hapus template shift' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: access.emp.id,
      aksi: 'hapus_template_shift',
      targetTable: 'shift_templates',
      targetId: id,
      detail: { before: pilihKolom(tpl) },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE template shift error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
