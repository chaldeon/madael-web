import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import {
  SETTING_KEY_LEWATI_KONFIRMASI, resolveLewatiKonfirmasi,
} from '@/lib/attendancePrefs';

// Preferensi "Lewati layar konfirmasi" untuk karyawan yang sedang login.
//
//   GET   -> { lewati, sumber, adminDefault, override, tersedia }
//              lewati : hasil akhir yang dipakai halaman Absensi
//              sumber : 'karyawan' (override pribadi) | 'admin' (default admin)
//              tersedia: false kalau migrasi database belum dijalankan; dalam kasus
//                        itu lewati = false (layar konfirmasi tetap tampil)
//   PATCH -> body { override: true | false | null }
//              true  = selalu lewati, false = selalu tampilkan,
//              null  = ikut default admin
//
// Ditulis lewat API server (bukan update langsung dari client) supaya tidak perlu
// membuka RLS UPDATE di tabel employees; endpoint ini hanya menyentuh SATU kolom
// milik pemanggil sendiri.

async function readAdminDefault(admin) {
  const { data, error } = await admin
    .from('app_settings')
    .select('value')
    .eq('key', SETTING_KEY_LEWATI_KONFIRMASI)
    .maybeSingle();
  return { value: data?.value ?? false, error };
}

export async function GET() {
  try {
    const session = await getSessionEmployee('id, status');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { emp } = session;
    const admin = createAdminClient();

    const [settingRes, ovRes] = await Promise.all([
      readAdminDefault(admin),
      admin.from('employees').select('lewati_konfirmasi_absensi').eq('id', emp.id).maybeSingle(),
    ]);

    if (settingRes.error || ovRes.error) {
      // Paling sering: migrasi belum dijalankan. Jangan gagalkan halaman Absensi —
      // aturan aman: layar konfirmasi tetap tampil.
      console.error('Baca preferensi konfirmasi absensi gagal:', settingRes.error || ovRes.error);
      return NextResponse.json({
        ...resolveLewatiKonfirmasi({ adminDefault: false, override: null }),
        lewati: false,
        tersedia: false,
      });
    }

    return NextResponse.json({
      ...resolveLewatiKonfirmasi({
        adminDefault: settingRes.value,
        override: ovRes.data?.lewati_konfirmasi_absensi,
      }),
      tersedia: true,
    });
  } catch (err) {
    console.error('GET preferensi absensi error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !('override' in body)) {
      return NextResponse.json({ error: 'override wajib diisi (true, false, atau null).' }, { status: 400 });
    }
    const override = body.override;
    if (override !== true && override !== false && override !== null) {
      return NextResponse.json({ error: 'override harus true, false, atau null.' }, { status: 400 });
    }

    const session = await getSessionEmployee('id, status');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { emp } = session;
    const admin = createAdminClient();

    const { error: updateError } = await admin
      .from('employees')
      .update({ lewati_konfirmasi_absensi: override })
      .eq('id', emp.id);

    if (updateError) {
      console.error('Simpan preferensi konfirmasi absensi gagal:', updateError);
      return NextResponse.json(
        { error: 'Preferensi belum bisa disimpan. Pastikan migrasi database sudah dijalankan.' },
        { status: 503 }
      );
    }

    const settingRes = await readAdminDefault(admin);
    return NextResponse.json({
      ...resolveLewatiKonfirmasi({ adminDefault: settingRes.error ? false : settingRes.value, override }),
      tersedia: true,
    });
  } catch (err) {
    console.error('PATCH preferensi absensi error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat menyimpan preferensi.' }, { status: 500 });
  }
}