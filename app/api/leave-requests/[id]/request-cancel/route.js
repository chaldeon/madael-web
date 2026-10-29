import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { notifyByModule } from '@/lib/notify';
import { todayJakarta } from '@/lib/serverTime';
import { friendlyError } from '@/lib/errorMessage';

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// POST /api/leave-requests/[id]/request-cancel
// Karyawan MEMINTA pembatalan cuti miliknya yang sudah disetujui (approved)
// dan belum dimulai (tanggal_mulai >= hari ini, WIB).
//
// Route ini TIDAK mengubah status pengajuan maupun kuota. Ia hanya
// memberi tahu pemegang modul leave_request_admin; keputusan tetap di tangan
// HR lewat aksi "Batalkan" yang sudah ada (decision route: approved ->
// cancelled, kuota dikembalikan di sana).
//
// Notifikasi dibatasi satu per pengajuan per hari (dedupeKey memuat tanggal
// WIB), jadi klik berulang tidak membanjiri HR, tetapi karyawan tetap bisa
// mengingatkan lagi esok harinya.
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll() {
            // no-op — route ini cuma butuh baca session
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum login.' }, { status: 401 });
    }

    const { data: emp } = await supabase
      .from('employees')
      .select('id, nama, status')
      .eq('email', user.email)
      .maybeSingle();

    if (!emp || emp.status !== 'Aktif') {
      return NextResponse.json({ error: 'Akun tidak aktif.' }, { status: 403 });
    }

    const admin = createAdminClient();

    const { data: row, error: rowError } = await admin
      .from('leave_requests')
      .select('id, status, tanggal_mulai, tanggal_selesai')
      .eq('id', id)
      .eq('employee_id', emp.id)
      .maybeSingle();

    if (rowError) {
      console.error('Minta batal cuti error:', rowError);
      return NextResponse.json(
        { error: `Gagal memuat pengajuan cuti: ${friendlyError(rowError, 'terjadi kesalahan pada server.', { context: 'Minta batal cuti' })}` },
        { status: 500 }
      );
    }
    if (!row) {
      return NextResponse.json({ error: 'Pengajuan cuti tidak ditemukan.' }, { status: 404 });
    }
    if (row.status !== 'approved') {
      return NextResponse.json(
        {
          error: row.status === 'pending'
            ? 'Pengajuan ini masih menunggu persetujuan. Gunakan tombol Batalkan.'
            : 'Hanya cuti yang sudah disetujui yang bisa diminta pembatalannya.',
          status: row.status,
        },
        { status: 409 }
      );
    }

    const hariIni = todayJakarta();
    if (row.tanggal_mulai < hariIni) {
      return NextResponse.json(
        { error: 'Cuti ini sudah dimulai atau sudah lewat, jadi tidak bisa diminta pembatalannya. Hubungi HR.' },
        { status: 409 }
      );
    }

    const periode = `${formatTanggal(row.tanggal_mulai)} – ${formatTanggal(row.tanggal_selesai)}`;
    const notif = await notifyByModule(admin, {
      moduleKey: 'leave_request_admin',
      tipe: 'cuti_minta_batal',
      pesan: `${emp.nama || 'Karyawan'} meminta pembatalan cuti yang sudah disetujui (${periode}). Buka Kelola Pengajuan Cuti, filter "Disetujui", lalu tekan Batalkan bila disetujui.`,
      link: '/employee/leave-request/admin',
      dedupeKey: `cuti_minta_batal:${row.id}:${hariIni}`,
    });

    if (!notif.ok) {
      return NextResponse.json(
        { error: 'Permintaan gagal dikirim ke HR, coba lagi.' },
        { status: 500 }
      );
    }

    // inserted = 0 tanpa error: permintaan hari ini sudah pernah terkirim.
    if (notif.inserted === 0) {
      return NextResponse.json({ success: true, alreadySent: true });
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'request_cancel_cuti',
      targetTable: 'leave_requests',
      targetId: row.id,
      detail: {
        employee_id: emp.id,
        tanggal_mulai: row.tanggal_mulai,
        tanggal_selesai: row.tanggal_selesai,
      },
    });

    return NextResponse.json({ success: true, alreadySent: false });
  } catch (err) {
    console.error('Minta batal cuti error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
