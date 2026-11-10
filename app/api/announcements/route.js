import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { normalizeAnnouncementInput, periksaPerusahaanTarget } from '@/lib/announcementsServer';
import { siarkanPengumuman } from '@/lib/announcementBroadcast';

// POST /api/announcements
//   body: { judul, isi, expired_at?, target_company_id?, pinned? }
//   -> 201 { announcement, notifikasi: { status, inserted? } }
//
// Hanya akun aktif dengan modul announcements_admin (superadmin lolos otomatis).
// Dulu browser menulis langsung ke tabel announcements: created_by dikirim
// client dan jejak audit-nya fire-and-forget dari browser. Sekarang created_by
// diambil dari sesi dan log dicatat di server.
//
// Notifikasi broadcast (event pengumuman_baru) disiarkan di sini juga, setelah
// pengumuman tersimpan, bukan lagi dipicu browser. Kegagalan siaran tidak
// membatalkan pengumuman: respons tetap 201 dengan notifikasi.status 'gagal',
// dan admin bisa mengulang lewat POST /api/announcements/[id]/broadcast.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['announcements_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => ({}));
    const parsed = normalizeAnnouncementInput(body);
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const companyError = await periksaPerusahaanTarget(admin, parsed.value.target_company_id);
    if (companyError) return NextResponse.json({ error: companyError }, { status: 400 });

    const { data, error } = await admin
      .from('announcements')
      .insert([{ ...parsed.value, created_by: emp.id }])
      .select()
      .single();
    if (error) {
      return NextResponse.json(
        { error: `Gagal menyimpan pengumuman: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Buat pengumuman' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'buat_pengumuman',
      targetTable: 'announcements',
      targetId: data.id,
      detail: { judul: data.judul },
    });

    const notifikasi = await siarkanPengumuman(admin, data.id);

    return NextResponse.json({ announcement: data, notifikasi }, { status: 201 });
  } catch (err) {
    console.error('Buat pengumuman:', err);
    return NextResponse.json({ error: 'Gagal menyimpan pengumuman.' }, { status: 500 });
  }
}
