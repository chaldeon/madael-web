import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { isMailConfigured } from '@/lib/applicationEmail';
import { EMAIL_CATEGORIES, EMAIL_CATEGORY_KEYS } from '@/lib/notificationEmailConfig';

// Preferensi email notifikasi untuk karyawan yang sedang login.
//
//   GET   -> { tersedia, emailAktif, prefs: { pengajuan, keputusan, slip, pengingat } }
//              tersedia  : false kalau tabel notification_preferences belum ada
//                          (migrasi belum dijalankan); UI menampilkan pesan, bukan error
//              emailAktif: false kalau SMTP belum dikonfigurasi di server
//              Tanpa baris tersimpan = semua kategori true (default).
//   PATCH -> body { pengajuan?: boolean, keputusan?: boolean, slip?: boolean, pengingat?: boolean }
//              Hanya kategori yang dikirim yang diubah.
//
// Ditulis lewat API server (service role); tabel tidak punya policy RLS untuk
// browser. Endpoint ini hanya menyentuh SATU baris milik pemanggil sendiri.

const COLUMNS = EMAIL_CATEGORY_KEYS.map((k) => EMAIL_CATEGORIES[k].column);

function toPrefs(row) {
  const prefs = {};
  for (const key of EMAIL_CATEGORY_KEYS) {
    prefs[key] = row?.[EMAIL_CATEGORIES[key].column] !== false;
  }
  return prefs;
}

export async function GET() {
  try {
    const session = await getSessionEmployee('id, status');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('notification_preferences')
      .select(COLUMNS.join(', '))
      .eq('employee_id', session.emp.id)
      .maybeSingle();

    if (error) {
      // Paling sering: migrasi belum dijalankan. Jangan gagalkan Pusat Notifikasi.
      console.error('Baca preferensi email notifikasi gagal:', error);
      return NextResponse.json({ tersedia: false, emailAktif: isMailConfigured(), prefs: toPrefs(null) });
    }

    return NextResponse.json({ tersedia: true, emailAktif: isMailConfigured(), prefs: toPrefs(data) });
  } catch (err) {
    console.error('GET notification-preferences error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body tidak valid.' }, { status: 400 });
    }

    const patch = {};
    for (const key of EMAIL_CATEGORY_KEYS) {
      if (!Object.hasOwn(body || {}, key)) continue;
      if (typeof body[key] !== 'boolean') {
        return NextResponse.json({ error: `Nilai "${key}" harus true atau false.` }, { status: 400 });
      }
      patch[EMAIL_CATEGORIES[key].column] = body[key];
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Tidak ada preferensi yang diubah.' }, { status: 400 });
    }

    const session = await getSessionEmployee('id, status');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('notification_preferences')
      .upsert(
        { employee_id: session.emp.id, ...patch, updated_at: new Date().toISOString() },
        { onConflict: 'employee_id' }
      )
      .select(COLUMNS.join(', '))
      .single();

    if (error) {
      console.error('Simpan preferensi email notifikasi gagal:', error);
      return NextResponse.json(
        { error: 'Preferensi belum bisa disimpan. Pastikan migrasi database sudah dijalankan.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, prefs: toPrefs(data) });
  } catch (err) {
    console.error('PATCH notification-preferences error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
