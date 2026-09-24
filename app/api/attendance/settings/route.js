import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { logActivity } from '@/lib/activityLog';
import { SETTING_KEY_LEWATI_KONFIRMASI, parseBoolSetting } from '@/lib/attendancePrefs';

// Pengaturan Absensi tingkat admin (khusus superadmin).
//
//   GET   -> { lewatiKonfirmasi, jumlahOverride, updatedAt }
//              lewatiKonfirmasi: default untuk SEMUA karyawan (boolean)
//              jumlahOverride  : jumlah karyawan aktif yang memilih pengaturan sendiri
//                                (pilihan mereka menimpa default ini)
//   PATCH -> body { lewatiKonfirmasi: boolean }
//
// Tabel app_settings tanpa policy RLS: hanya service role (route ini) yang boleh
// baca/tulis. Perubahan dicatat ke activity log.

async function requireSuperadmin() {
  const session = await getSessionEmployee('id, status, is_superadmin');
  if (session.error) return { response: NextResponse.json({ error: session.error }, { status: session.status }) };
  if (!session.emp.is_superadmin) {
    return {
      response: NextResponse.json(
        { error: 'Hanya superadmin yang boleh mengubah pengaturan absensi.' },
        { status: 403 }
      ),
    };
  }
  return { emp: session.emp };
}

export async function GET() {
  try {
    const auth = await requireSuperadmin();
    if (auth.response) return auth.response;

    const admin = createAdminClient();
    const [settingRes, countRes] = await Promise.all([
      admin.from('app_settings').select('value, updated_at').eq('key', SETTING_KEY_LEWATI_KONFIRMASI).maybeSingle(),
      admin
        .from('employees')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Aktif')
        .not('lewati_konfirmasi_absensi', 'is', null),
    ]);

    if (settingRes.error || countRes.error) {
      console.error('Baca pengaturan absensi gagal:', settingRes.error || countRes.error);
      return NextResponse.json(
        { error: 'Pengaturan belum bisa dimuat. Pastikan migrasi database sudah dijalankan.' },
        { status: 503 }
      );
    }

    return NextResponse.json({
      lewatiKonfirmasi: parseBoolSetting(settingRes.data?.value),
      jumlahOverride: countRes.count ?? 0,
      updatedAt: settingRes.data?.updated_at ?? null,
    });
  } catch (err) {
    console.error('GET pengaturan absensi error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.lewatiKonfirmasi !== 'boolean') {
      return NextResponse.json({ error: 'lewatiKonfirmasi harus true atau false.' }, { status: 400 });
    }
    const nilai = body.lewatiKonfirmasi;

    const auth = await requireSuperadmin();
    if (auth.response) return auth.response;

    const admin = createAdminClient();

    const { data: before } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', SETTING_KEY_LEWATI_KONFIRMASI)
      .maybeSingle();

    const updatedAt = new Date().toISOString();
    const { error } = await admin
      .from('app_settings')
      .upsert(
        { key: SETTING_KEY_LEWATI_KONFIRMASI, value: nilai, updated_at: updatedAt, updated_by: auth.emp.id },
        { onConflict: 'key' }
      );

    if (error) {
      console.error('Simpan pengaturan absensi gagal:', error);
      return NextResponse.json(
        { error: 'Pengaturan belum bisa disimpan. Pastikan migrasi database sudah dijalankan.' },
        { status: 503 }
      );
    }

    await logActivity(admin, {
      userId: auth.emp.id,
      aksi: 'ubah_pengaturan_absensi',
      targetTable: 'app_settings',
      detail: {
        key: SETTING_KEY_LEWATI_KONFIRMASI,
        before: parseBoolSetting(before?.value),
        after: nilai,
      },
    });

    return NextResponse.json({ lewatiKonfirmasi: nilai, updatedAt });
  } catch (err) {
    console.error('PATCH pengaturan absensi error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat menyimpan pengaturan.' }, { status: 500 });
  }
}