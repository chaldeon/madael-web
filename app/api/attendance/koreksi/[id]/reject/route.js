import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployee } from '@/lib/notify';
import { friendlyError } from '@/lib/errorMessage';

const MAKS_CATATAN = 1000;

// Sama dengan formatTanggal di lib/absensiKaryawanConfig.js (dengan nama hari),
// dan dengan route approve, supaya teks notifikasi seragam.
function formatTanggalId(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

const PESAN_BUKAN_PENDING =
  'Pengajuan ini sudah tidak berstatus menunggu (mungkin dibatalkan karyawan atau sudah diproses). Daftar dimuat ulang.';

// POST /api/attendance/koreksi/[id]/reject   body: { catatan?: string }
// Superadmin menolak pengajuan koreksi absensi mandiri karyawan.
//
// Dulu dilakukan dari browser (update tabel + log + notifikasi dari klien,
// dengan reviewed_by dari klien). Sekarang semuanya di server, sejajar dengan
// route approve: akses dicek di server, status diubah dengan UPDATE bersyarat
// pending -> rejected (compare-and-swap; pembatalan karyawan memakai syarat
// 'pending' yang sama, jadi hanya satu yang menang), reviewed_by diambil dari
// sesi, lalu log aktivitas dan notifikasi ditulis server-side.
// Penolakan tidak menyentuh tabel attendance.
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['absensi_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;
    if (!emp.is_superadmin) {
      return NextResponse.json(
        { error: 'Hanya superadmin yang boleh menolak koreksi absensi.' },
        { status: 403 }
      );
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const rawCatatan = body?.catatan;
    if (rawCatatan != null && typeof rawCatatan !== 'string') {
      return NextResponse.json({ error: 'Catatan tidak valid.' }, { status: 400 });
    }
    const catatan = (rawCatatan || '').trim();
    if (catatan.length > MAKS_CATATAN) {
      return NextResponse.json(
        { error: `Catatan terlalu panjang (maksimal ${MAKS_CATATAN} karakter).` },
        { status: 400 }
      );
    }

    const { data: row, error: rowError } = await admin
      .from('attendance_corrections')
      .select('id, employee_id, tanggal, status')
      .eq('id', id)
      .not('requested_by', 'is', null) // hanya pengajuan mandiri karyawan
      .maybeSingle();
    if (rowError) {
      return NextResponse.json(
        { error: `Gagal memuat pengajuan koreksi: ${friendlyError(rowError, 'terjadi kesalahan pada server.', { context: 'Muat pengajuan koreksi absensi' })}` },
        { status: 500 }
      );
    }
    if (!row) {
      return NextResponse.json({ error: 'Pengajuan koreksi tidak ditemukan.' }, { status: 404 });
    }
    if (row.status !== 'pending') {
      return NextResponse.json({ error: PESAN_BUKAN_PENDING, status: row.status }, { status: 409 });
    }

    const sekarang = new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from('attendance_corrections')
      .update({
        status: 'rejected',
        reviewed_by: emp.id,
        reviewed_at: sekarang,
        catatan_reviewer: catatan || null,
      })
      .eq('id', id)
      .eq('status', 'pending') // jangan timpa pengajuan yang sudah dibatalkan karyawan
      .select('id')
      .maybeSingle();
    if (updateError) {
      console.error('Tolak koreksi absensi error:', updateError);
      return NextResponse.json(
        { error: `Gagal menolak pengajuan koreksi: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Tolak koreksi absensi' })}` },
        { status: 500 }
      );
    }
    if (!updated) {
      // Kalah balapan: dibatalkan karyawan / diproses superadmin lain.
      return NextResponse.json({ error: PESAN_BUKAN_PENDING }, { status: 409 });
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'reject_koreksi_absensi',
      targetTable: 'attendance_corrections',
      targetId: row.id,
      detail: { employee_id: row.employee_id, tanggal: row.tanggal, catatan: catatan || null },
    });

    await notifyEmployee(admin, {
      userId: row.employee_id,
      tipe: 'koreksi_absensi_ditolak',
      pesan: `Pengajuan koreksi absensi tanggal ${formatTanggalId(row.tanggal)} ditolak.${catatan ? ` Alasan: ${catatan}` : ''}`,
      link: '/employee/absensi',
    });

    return NextResponse.json({
      success: true,
      reviewed_at: sekarang,
      catatan_reviewer: catatan || null,
    });
  } catch (err) {
    console.error('Tolak koreksi absensi error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
