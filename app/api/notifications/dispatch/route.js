import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import {
  notifyEmployee,
  notifyEmployees,
  notifySuperadmins,
  notifyByModule,
  notifyAllActive,
} from '@/lib/notify';
import {
  NOTIFICATION_EVENTS,
  MAKS_PESAN,
  JENDELA_DUPLIKAT_MS,
} from '@/lib/notificationEvents';

// POST /api/notifications/dispatch
// Body: { event, id }
//
// Satu-satunya jalan bagi browser untuk memicu notifikasi. Browser tidak punya
// izin INSERT ke tabel notifications. Penerima, pesan, dan link disusun server
// dari record di database (lihat lib/notificationEvents.js), bukan diterima
// dari body.
export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Body tidak valid.' }, { status: 400 });
    }

    const { event, id } = body || {};
    const def = typeof event === 'string' && Object.hasOwn(NOTIFICATION_EVENTS, event)
      ? NOTIFICATION_EVENTS[event]
      : null;
    if (!def) {
      return NextResponse.json({ error: 'Event tidak dikenal.' }, { status: 400 });
    }
    if ((typeof id !== 'string' && typeof id !== 'number') || String(id).length > 100) {
      return NextResponse.json({ error: 'id tidak valid.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, def.needs);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const result = await def.build({ admin, emp: access.emp, id });
    if (!result) {
      return NextResponse.json({ error: 'Data tidak memenuhi syarat untuk notifikasi ini.' }, { status: 422 });
    }

    const pesan = String(result.pesan).slice(0, MAKS_PESAN);

    // Anti-duplikat: event yang sama persis dalam 10 menit terakhir diabaikan.
    const since = new Date(Date.now() - JENDELA_DUPLIKAT_MS).toISOString();
    const { data: dupe } = await admin
      .from('notifications')
      .select('id')
      .eq('tipe', result.tipe)
      .eq('pesan', pesan)
      .gte('created_at', since)
      .limit(1);
    if (dupe && dupe.length > 0) {
      return NextResponse.json({ success: true, duplicate: true });
    }

    const payload = { tipe: result.tipe, pesan, link: result.link };
    const to = result.to;
    if (to === 'superadmins') {
      await notifySuperadmins(admin, payload);
    } else if (to === 'all_active') {
      await notifyAllActive(admin, payload);
    } else if (typeof to?.module === 'string') {
      await notifyByModule(admin, { moduleKey: to.module, ...payload });
    } else if (to?.userId) {
      await notifyEmployee(admin, { userId: to.userId, ...payload });
    } else if (Array.isArray(to?.userIds)) {
      await notifyEmployees(admin, { userIds: to.userIds, ...payload });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Dispatch notifikasi error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
