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

    // Anti-duplikat: tiap penerima hanya dapat satu notifikasi per (tipe + id
    // sumber). Dijaga unique index (user_id, dedupe_key), jadi dua kejadian
    // berbeda dengan teks sama tidak saling menelan, dan request paralel pun aman.
    const dedupeKey = `${result.tipe}:${String(id)}`;

    // Event broadcast (mis. pengumuman_baru) hanya boleh disiarkan sekali.
    let claimed = false;
    if (typeof def.claim === 'function') {
      claimed = await def.claim({ admin, id });
      if (!claimed) {
        return NextResponse.json({ error: 'Event ini sudah pernah disiarkan.' }, { status: 409 });
      }
    }

    const payload = { tipe: result.tipe, pesan, link: result.link, dedupeKey };
    const to = result.to;
    let outcome = null;
    try {
      if (to === 'superadmins') {
        outcome = await notifySuperadmins(admin, payload);
      } else if (to === 'all_active') {
        outcome = await notifyAllActive(admin, payload);
      } else if (typeof to?.module === 'string') {
        outcome = await notifyByModule(admin, { moduleKey: to.module, ...payload });
      } else if (to?.userId) {
        outcome = await notifyEmployee(admin, { userId: to.userId, ...payload });
      } else if (Array.isArray(to?.userIds)) {
        outcome = await notifyEmployees(admin, { userIds: to.userIds, ...payload });
      }
    } catch (err) {
      console.error('Dispatch notifikasi gagal mengirim:', err);
    }

    // Pengiriman gagal: lepas tanda "sudah disiarkan" supaya bisa dicoba lagi.
    // Mengulang aman — penerima yang sudah menerima dilewati oleh kunci dedupe.
    if (!outcome || outcome.ok === false) {
      if (claimed && typeof def.release === 'function') {
        try {
          await def.release({ admin, id });
        } catch (err) {
          console.error('Dispatch notifikasi gagal melepas tanda siaran:', err);
        }
      }
      return NextResponse.json({ error: 'Gagal mengirim notifikasi.' }, { status: 500 });
    }

    if (outcome.inserted === 0) {
      return NextResponse.json({ success: true, duplicate: true });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Dispatch notifikasi error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
