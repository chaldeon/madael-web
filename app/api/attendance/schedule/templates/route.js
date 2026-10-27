import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { requireJadwalAdmin, validateTemplateInput } from '@/lib/scheduleServer';

// POST /api/attendance/schedule/templates
// body: { nama, jam_masuk, jam_pulang, toleransi_menit, hari_kerja, aktif? }
// Tambah template shift. Khusus superadmin; input divalidasi di server
// (aturan yang sama dengan form: lib/shifts.js validateShiftForm).
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireJadwalAdmin(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await request.json().catch(() => null);
    const parsed = validateTemplateInput(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data: created, error } = await admin
      .from('shift_templates')
      .insert([parsed.value])
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Nama shift itu sudah dipakai.' }, { status: 409 });
      }
      console.error('Tambah template shift error:', error);
      return NextResponse.json(
        { error: `Gagal menyimpan shift: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Tambah template shift' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: access.emp.id,
      aksi: 'tambah_template_shift',
      targetTable: 'shift_templates',
      targetId: created.id,
      detail: { after: parsed.value },
    });

    return NextResponse.json({ success: true, template: created });
  } catch (err) {
    console.error('POST template shift error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
