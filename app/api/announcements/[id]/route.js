import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import {
  fieldPengumumanBerubah,
  normalizeAnnouncementInput,
  periksaPerusahaanTarget,
} from '@/lib/announcementsServer';

const ACTIONS = ['edit', 'expire', 'pin'];

// Hanya akun aktif dengan modul announcements_admin (superadmin lolos otomatis).
async function gate(admin) {
  const access = await requireModuleAccess(admin, ['announcements_admin']);
  if (access.error) {
    return { response: NextResponse.json({ error: access.error }, { status: access.status }) };
  }
  return { emp: access.emp };
}

async function muatPengumuman(admin, id) {
  const { data, error } = await admin.from('announcements').select('*').eq('id', id).maybeSingle();
  if (error) {
    // 22P02 = id bukan format yang valid untuk kolom id
    if (error.code === '22P02') {
      return { response: NextResponse.json({ error: 'Pengumuman tidak ditemukan.' }, { status: 404 }) };
    }
    throw error;
  }
  if (!data) {
    return { response: NextResponse.json({ error: 'Pengumuman tidak ditemukan.' }, { status: 404 }) };
  }
  return { row: data };
}

// PATCH /api/announcements/[id]   body: { action, ... }
//   'edit'   : { judul, isi, expired_at?, target_company_id?, pinned? }
//              (tidak menyiarkan notifikasi ulang)
//   'expire' : nonaktifkan sekarang (expired_at = waktu server)
//   'pin'    : { pinned: boolean }
// -> { announcement }
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();
    const g = await gate(admin);
    if (g.response) return g.response;
    const { emp } = g;

    const body = await request.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : '';
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Aksi tidak valid.' }, { status: 400 });
    }

    const loaded = await muatPengumuman(admin, id);
    if (loaded.response) return loaded.response;
    const { row } = loaded;

    let patch;
    if (action === 'edit') {
      const parsed = normalizeAnnouncementInput(body);
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
      const companyError = await periksaPerusahaanTarget(admin, parsed.value.target_company_id);
      if (companyError) return NextResponse.json({ error: companyError }, { status: 400 });
      patch = parsed.value;
    } else if (action === 'expire') {
      patch = { expired_at: new Date().toISOString() };
    } else {
      if (typeof body.pinned !== 'boolean') {
        return NextResponse.json({ error: 'Status pin tidak valid.' }, { status: 400 });
      }
      patch = { pinned: body.pinned };
    }

    const { data, error } = await admin
      .from('announcements')
      .update(patch)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) {
      return NextResponse.json(
        { error: `Gagal menyimpan perubahan pengumuman: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Ubah pengumuman' })}` },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: 'Pengumuman tidak ditemukan.' }, { status: 404 });
    }

    const log =
      action === 'expire'
        ? { aksi: 'nonaktifkan_pengumuman', detail: { judul: data.judul } }
        : action === 'pin'
          ? { aksi: 'edit_pengumuman', detail: { judul: data.judul, pinned: data.pinned } }
          : {
              aksi: 'edit_pengumuman',
              detail: { judul: data.judul, field_diubah: fieldPengumumanBerubah(row, patch) },
            };
    await logActivity(admin, {
      userId: emp.id,
      aksi: log.aksi,
      targetTable: 'announcements',
      targetId: data.id,
      detail: log.detail,
    });

    return NextResponse.json({ announcement: data });
  } catch (err) {
    console.error('Ubah pengumuman:', err);
    return NextResponse.json({ error: 'Gagal menyimpan perubahan pengumuman.' }, { status: 500 });
  }
}

// DELETE /api/announcements/[id] -> { ok: true }
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();
    const g = await gate(admin);
    if (g.response) return g.response;
    const { emp } = g;

    const loaded = await muatPengumuman(admin, id);
    if (loaded.response) return loaded.response;
    const { row } = loaded;

    const { error } = await admin.from('announcements').delete().eq('id', id);
    if (error) {
      return NextResponse.json(
        { error: `Gagal menghapus pengumuman: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Hapus pengumuman' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'hapus_pengumuman',
      targetTable: 'announcements',
      targetId: row.id,
      detail: { judul: row.judul },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Hapus pengumuman:', err);
    return NextResponse.json({ error: 'Gagal menghapus pengumuman.' }, { status: 500 });
  }
}
