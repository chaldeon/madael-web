import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployee } from '@/lib/notify';
import {
  labelJenisCuti, potongKuota,
  SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN, MAKS_CATATAN_TOLAK_CUTI,
} from '@/lib/leave';
import { formatTanggal } from '@/lib/leaveServer';
import { friendlyError } from '@/lib/errorMessage';

// POST /api/leave-requests/[id]/reject-cancel   body: { catatan? }
// HR MENOLAK permintaan karyawan untuk membatalkan cuti yang sudah disetujui.
// Cuti tetap berlaku (status 'approved' dan kuota tidak berubah); yang berubah
// hanya minta_batal_status: 'menunggu' -> 'ditolak' + catatan HR (opsional,
// maks MAKS_CATATAN_TOLAK_CUTI karakter), lalu karyawan diberi tahu.
//
// Menyetujui permintaan = membatalkan cuti lewat decision route
// (decision: 'cancelled'), yang mengembalikan kuota dan menandai permintaan
// 'disetujui'. Karyawan boleh meminta lagi setelah ditolak.
//
// Hanya akun aktif dengan modul leave_request_admin (superadmin lolos otomatis).
// Seperti setujui/tolak pengajuan, permintaan milik sendiri tidak boleh dijawab
// sendiri (SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN). Update bersyarat pada status
// 'approved' + 'menunggu' sehingga atomik terhadap HR lain yang menjawab atau
// membatalkan cuti itu di saat yang sama.
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['leave_request_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => ({}));
    const catatanMentah = typeof body?.catatan === 'string' ? body.catatan.trim() : '';
    if (catatanMentah.length > MAKS_CATATAN_TOLAK_CUTI) {
      return NextResponse.json(
        { error: `Catatan maksimal ${MAKS_CATATAN_TOLAK_CUTI} karakter.` },
        { status: 400 }
      );
    }
    const catatan = catatanMentah || null;

    const { data: row, error: rowError } = await admin
      .from('leave_requests')
      .select('id, employee_id, jenis, status, tanggal_mulai, tanggal_selesai, minta_batal_status')
      .eq('id', id)
      .maybeSingle();
    if (rowError) {
      return NextResponse.json({ error: `Gagal memuat pengajuan: ${friendlyError(rowError, 'terjadi kesalahan pada server.', { context: 'Muat pengajuan cuti' })}` }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: 'Pengajuan cuti tidak ditemukan.' }, { status: 404 });
    }

    if (row.employee_id === emp.id && !(SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN && emp.is_superadmin)) {
      return NextResponse.json({ error: 'Tidak boleh memproses permintaan pembatalan cuti milik sendiri.' }, { status: 403 });
    }

    if (row.status !== 'approved' || row.minta_batal_status !== 'menunggu') {
      return NextResponse.json(
        {
          error: 'Permintaan pembatalan ini sudah tidak menunggu (mungkin sudah dijawab atau cutinya sudah dibatalkan). Daftar dimuat ulang.',
          status: row.status,
        },
        { status: 409 }
      );
    }

    const { data: updated, error: updateError } = await admin
      .from('leave_requests')
      .update({ minta_batal_status: 'ditolak', minta_batal_catatan: catatan })
      .eq('id', id)
      .eq('status', 'approved')
      .eq('minta_batal_status', 'menunggu')
      .select()
      .maybeSingle();

    if (updateError) {
      console.error('Tolak permintaan batal cuti error:', updateError);
      return NextResponse.json(
        { error: `Gagal menolak permintaan pembatalan: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Tolak permintaan batal cuti' })}` },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'Permintaan ini baru saja diproses pihak lain. Daftar dimuat ulang.' },
        { status: 409 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'reject_minta_batal_cuti',
      targetTable: 'leave_requests',
      targetId: row.id,
      detail: {
        employee_id: row.employee_id,
        tanggal_mulai: row.tanggal_mulai,
        tanggal_selesai: row.tanggal_selesai,
        jenis: row.jenis || 'tahunan',
        catatan,
      },
    });

    const noun = potongKuota(row.jenis) ? 'cuti' : labelJenisCuti(row.jenis).toLowerCase();
    await notifyEmployee(admin, {
      userId: row.employee_id,
      tipe: 'cuti_minta_batal_ditolak',
      pesan: `Permintaan pembatalan ${noun} kamu (${formatTanggal(row.tanggal_mulai)} – ${formatTanggal(row.tanggal_selesai)}) ditolak HR, jadi cutimu tetap berlaku.${catatan ? ` Catatan HR: ${catatan}` : ''}`,
      link: '/employee/leave-request',
    });

    return NextResponse.json({ success: true, request: updated });
  } catch (err) {
    console.error('Tolak permintaan batal cuti error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
