import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { scheduleFieldsFromTemplate } from '@/lib/shifts';
import { ambilTemplate, isSafeId, requireJadwalAdmin, validateJadwalKustom } from '@/lib/scheduleServer';

// POST /api/attendance/schedule
// body: { employee_id, shift_template_id?, jam_masuk, jam_pulang, hari_kerja, toleransi_menit }
// Simpan (buat atau ganti) jadwal kerja SATU karyawan. Khusus superadmin.
//
// - Dengan shift_template_id: jam/hari/toleransi DISALIN dari template di server
//   (nilai dari klien diabaikan), jadi invarian "baris tertaut = template-nya"
//   tidak bisa dilanggar dari browser. Template nonaktif hanya boleh dipasang
//   kalau memang sudah dipakai karyawan itu.
// - Tanpa shift_template_id (kustom): nilai dari klien divalidasi (format jam,
//   hari kerja, toleransi) dan tautan template dilepas.
//
// Dulu ditulis langsung dari browser ke tabel work_schedule. Tabel itu tidak
// lagi punya hak tulis untuk browser (lihat migrasi
// supabase/migrations/20261027120000_jadwal_kerja_server_only_writes.sql).
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireJadwalAdmin(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Data jadwal tidak valid.' }, { status: 400 });
    }
    if (!isSafeId(body.employee_id)) {
      return NextResponse.json({ error: 'Karyawan tidak valid.' }, { status: 400 });
    }

    const { data: emp, error: empError } = await admin
      .from('employees')
      .select('id, nama, status')
      .eq('id', body.employee_id)
      .maybeSingle();
    if (empError) {
      return NextResponse.json(
        { error: `Gagal memuat karyawan: ${friendlyError(empError, 'terjadi kesalahan pada server.', { context: 'Muat karyawan untuk jadwal' })}` },
        { status: 500 }
      );
    }
    if (!emp) return NextResponse.json({ error: 'Karyawan tidak ditemukan.' }, { status: 404 });
    if (emp.status !== 'Aktif') {
      return NextResponse.json({ error: 'Jadwal hanya bisa diatur untuk karyawan berstatus Aktif.' }, { status: 409 });
    }

    const { data: before, error: beforeError } = await admin
      .from('work_schedule')
      .select('*')
      .eq('employee_id', emp.id)
      .maybeSingle();
    if (beforeError) {
      return NextResponse.json(
        { error: `Gagal memuat jadwal saat ini: ${friendlyError(beforeError, 'terjadi kesalahan pada server.', { context: 'Muat jadwal kerja' })}` },
        { status: 500 }
      );
    }

    const templateId = body.shift_template_id ? body.shift_template_id : null;
    let nilai;
    if (templateId) {
      const found = await ambilTemplate(admin, templateId);
      if (found.error) {
        if (found.cause) console.error('Muat template shift error:', found.cause);
        return NextResponse.json({ error: found.error }, { status: found.status });
      }
      if (!found.template.aktif && before?.shift_template_id !== found.template.id) {
        return NextResponse.json({ error: 'Template shift ini nonaktif, tidak bisa dipasang ke karyawan baru.' }, { status: 409 });
      }
      nilai = scheduleFieldsFromTemplate(found.template);
    } else {
      const parsed = validateJadwalKustom(body);
      if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
      nilai = parsed.value;
      // Kolom shift_template_id baru ada setelah migrasi shift dijalankan. Lepas
      // tautan hanya kalau kolomnya memang ada di baris yang sudah tersimpan.
      if (before && 'shift_template_id' in before) nilai.shift_template_id = null;
    }

    const { data: saved, error } = await admin
      .from('work_schedule')
      .upsert([{ employee_id: emp.id, ...nilai }], { onConflict: 'employee_id' })
      .select()
      .single();
    if (error) {
      console.error('Simpan jadwal kerja error:', error);
      return NextResponse.json(
        { error: `Gagal menyimpan jadwal: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Simpan jadwal kerja' })}` },
        { status: 500 }
      );
    }

    const ringkas = (row) => (row ? {
      jam_masuk: row.jam_masuk,
      jam_pulang: row.jam_pulang,
      hari_kerja: row.hari_kerja,
      toleransi_menit: row.toleransi_menit,
      shift_template_id: row.shift_template_id ?? null,
    } : null);
    await logActivity(admin, {
      userId: access.emp.id,
      aksi: 'ubah_jadwal_kerja',
      targetTable: 'work_schedule',
      targetId: saved.id ?? emp.id,
      detail: { employee_id: emp.id, nama: emp.nama, before: ringkas(before), after: ringkas(saved) },
    });

    return NextResponse.json({ success: true, schedule: saved });
  } catch (err) {
    console.error('POST jadwal kerja error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
