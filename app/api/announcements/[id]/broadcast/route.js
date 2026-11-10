import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { bisaKirimUlangNotifikasi } from '@/lib/announcements';
import { siarkanPengumuman } from '@/lib/announcementBroadcast';

// POST /api/announcements/[id]/broadcast
//   -> 200 { notifikasi: { status: 'terkirim', inserted } }
//
// Jalur kirim ulang notifikasi pengumuman yang belum pernah terkirim
// (broadcast_at masih kosong), mis. karena siaran saat pembuatan gagal.
// Hanya akun aktif dengan modul announcements_admin (superadmin lolos).
//
// Batas pengaman: hanya untuk pengumuman yang masih aktif dan dibuat dalam
// JENDELA_KIRIM_ULANG_MS (lihat lib/announcements.js), supaya pengumuman lama
// tidak tersiar massal. Mengulang aman: penerima yang sudah menerima dilewati
// kunci dedupe, dan tanda broadcast_at diklaim atomik.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['announcements_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const { data: row, error } = await admin
      .from('announcements')
      .select('id, judul, expired_at, created_at, broadcast_at')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      // 22P02 = id bukan format yang valid untuk kolom id
      if (error.code === '22P02') {
        return NextResponse.json({ error: 'Pengumuman tidak ditemukan.' }, { status: 404 });
      }
      throw error;
    }
    if (!row) {
      return NextResponse.json({ error: 'Pengumuman tidak ditemukan.' }, { status: 404 });
    }

    if (row.broadcast_at) {
      return NextResponse.json({ error: 'Notifikasi pengumuman ini sudah pernah dikirim.' }, { status: 409 });
    }
    if (!bisaKirimUlangNotifikasi(row)) {
      return NextResponse.json(
        { error: 'Notifikasi hanya bisa dikirim untuk pengumuman yang masih aktif dan dibuat dalam 7 hari terakhir.' },
        { status: 409 }
      );
    }

    const notifikasi = await siarkanPengumuman(admin, row.id);

    if (notifikasi.status === 'sudah_disiarkan') {
      return NextResponse.json({ error: 'Notifikasi pengumuman ini sudah pernah dikirim.' }, { status: 409 });
    }
    if (notifikasi.status === 'dilewati') {
      return NextResponse.json({ error: 'Pengumuman sudah tidak aktif, notifikasi tidak dikirim.' }, { status: 409 });
    }
    if (notifikasi.status !== 'terkirim') {
      return NextResponse.json({ error: 'Gagal mengirim notifikasi. Silakan coba lagi.' }, { status: 500 });
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'kirim_notifikasi_pengumuman',
      targetTable: 'announcements',
      targetId: row.id,
      detail: { judul: row.judul, penerima_baru: notifikasi.inserted },
    });

    return NextResponse.json({ notifikasi });
  } catch (err) {
    console.error('Kirim ulang notifikasi pengumuman:', err);
    return NextResponse.json({ error: 'Gagal mengirim notifikasi.' }, { status: 500 });
  }
}
