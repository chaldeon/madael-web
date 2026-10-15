import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { CLIENT_LOG_POLICY, MAKS_DETAIL_BYTES } from '@/lib/activityLogPolicy';

// POST /api/activity-log
// Body: { aksi, targetTable, targetId, detail }
//
// Pintu satu-satunya bagi browser untuk mencatat audit trail. Browser tidak
// punya izin INSERT ke activity_logs, jadi:
//   - user_id SELALU diambil dari sesi login, bukan dari body (tidak bisa
//     mencatat atas nama orang lain);
//   - `aksi` harus terdaftar di CLIENT_LOG_POLICY dan cocok dengan tabel
//     targetnya;
//   - pemanggil harus memegang modul yang berwenang atas aksi itu.
// Batas yang tetap ada: mutasi data yang dilakukan dari browser tidak bisa
// dipaksa tercatat dari sini (browser bisa saja tidak memanggil endpoint ini).
// Untuk audit yang tidak bisa dilewati, pindahkan mutasinya ke API route atau
// pasang trigger DB di tabelnya.
export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body tidak valid.' }, { status: 400 });
    }

    const { aksi, targetTable = null, targetId = null, detail = null } = body || {};

    const policy = typeof aksi === 'string' && Object.hasOwn(CLIENT_LOG_POLICY, aksi)
      ? CLIENT_LOG_POLICY[aksi]
      : null;
    if (!policy) {
      return NextResponse.json({ error: 'Aksi tidak dikenal.' }, { status: 400 });
    }
    if (targetTable !== policy.table) {
      return NextResponse.json({ error: 'Tabel target tidak sesuai.' }, { status: 400 });
    }

    const targetIdOk =
      targetId === null ||
      ((typeof targetId === 'string' || typeof targetId === 'number') && String(targetId).length <= 100);
    if (!targetIdOk) {
      return NextResponse.json({ error: 'targetId tidak valid.' }, { status: 400 });
    }

    const detailOk =
      detail === null ||
      (typeof detail === 'object' && !Array.isArray(detail) &&
        JSON.stringify(detail).length <= MAKS_DETAIL_BYTES);
    if (!detailOk) {
      return NextResponse.json({ error: 'Detail tidak valid atau terlalu besar.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, policy.needs);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { error } = await admin.from('activity_logs').insert([{
      user_id: access.emp.id,
      aksi,
      target_table: policy.table,
      target_id: targetId === null ? null : String(targetId),
      detail,
    }]);
    if (error) {
      console.error('Catat activity log error:', error);
      return NextResponse.json({ error: 'Gagal mencatat log.' }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error('Catat activity log error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
