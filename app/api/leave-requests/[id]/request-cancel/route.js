import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { notifyByModule } from '@/lib/notify';
import { todayJakarta } from '@/lib/serverTime';
import { friendlyError } from '@/lib/errorMessage';
import { MAKS_ALASAN_MINTA_BATAL_CUTI } from '@/lib/leave';

const KOLOM_STATUS_MINTA_BATAL =
  'id, status, tanggal_mulai, tanggal_selesai, minta_batal_status, minta_batal_at, minta_batal_alasan, minta_batal_catatan';

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// POST /api/leave-requests/[id]/request-cancel   body: { alasan? }
// Karyawan MEMINTA pembatalan cuti miliknya yang sudah disetujui (approved)
// dan belum dimulai (tanggal_mulai >= hari ini, WIB).
//
// Permintaan DISIMPAN di leave_requests (minta_batal_status = 'menunggu',
// minta_batal_at, minta_batal_alasan), jadi statusnya tidak hilang saat halaman
// dimuat ulang dan HR bisa menjawabnya: setujui lewat decision route
// (approved -> cancelled, kuota dikembalikan di sana) atau tolak lewat
// reject-cancel. Route ini TIDAK mengubah status pengajuan maupun kuota.
//
// Idempoten: selama permintaan masih 'menunggu', permintaan ulang tidak
// mengubah apa pun dan tidak mengirim notifikasi lagi (alreadySent: true).
// Setelah HR menolak ('ditolak'), karyawan boleh meminta lagi; permintaan baru
// menimpa alasan/catatan sebelumnya dan memberi tahu HR lagi.
//
// Update bersyarat (status approved + belum 'menunggu') sehingga atomik
// terhadap HR yang membatalkan/menjawab di saat yang sama. Notifikasi ke HR
// hanya pelengkap: bila gagal terkirim, permintaan tetap tersimpan dan muncul
// di filter "Permintaan batal", badge, dan Inbox Persetujuan.
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

    // Alasan: opsional, hanya teks (body kosong/bukan JSON dianggap tanpa alasan).
    const body = await request.json().catch(() => ({}));
    const alasanMentah = typeof body?.alasan === 'string' ? body.alasan.trim() : '';
    if (alasanMentah.length > MAKS_ALASAN_MINTA_BATAL_CUTI) {
      return NextResponse.json(
        { error: `Alasan maksimal ${MAKS_ALASAN_MINTA_BATAL_CUTI} karakter.` },
        { status: 400 }
      );
    }
    const alasan = alasanMentah || null;

    const { data: row, error: rowError } = await admin
      .from('leave_requests')
      .select(KOLOM_STATUS_MINTA_BATAL)
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

    // Permintaan yang sama masih menunggu jawaban HR: tidak ada yang berubah.
    if (row.minta_batal_status === 'menunggu') {
      return NextResponse.json({ success: true, alreadySent: true, request: row });
    }

    const sekarang = new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from('leave_requests')
      .update({
        minta_batal_status: 'menunggu',
        minta_batal_at: sekarang,
        minta_batal_alasan: alasan,
        minta_batal_catatan: null,
      })
      .eq('id', row.id)
      .eq('employee_id', emp.id)
      .eq('status', 'approved')
      .or('minta_batal_status.is.null,minta_batal_status.eq.ditolak')
      .select(KOLOM_STATUS_MINTA_BATAL)
      .maybeSingle();

    if (updateError) {
      console.error('Simpan permintaan batal cuti error:', updateError);
      return NextResponse.json(
        { error: `Gagal menyimpan permintaan pembatalan: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Simpan permintaan batal cuti' })}` },
        { status: 500 }
      );
    }

    if (!updated) {
      // Kalah balapan: baca ulang untuk tahu apa yang terjadi.
      const { data: terbaru } = await admin
        .from('leave_requests')
        .select(KOLOM_STATUS_MINTA_BATAL)
        .eq('id', row.id)
        .eq('employee_id', emp.id)
        .maybeSingle();
      if (terbaru?.status === 'approved' && terbaru.minta_batal_status === 'menunggu') {
        return NextResponse.json({ success: true, alreadySent: true, request: terbaru });
      }
      return NextResponse.json(
        {
          error: 'Status pengajuan ini baru saja berubah. Muat ulang halaman lalu coba lagi.',
          status: terbaru?.status || row.status,
        },
        { status: 409 }
      );
    }

    const periode = `${formatTanggal(row.tanggal_mulai)} – ${formatTanggal(row.tanggal_selesai)}`;
    const notif = await notifyByModule(admin, {
      moduleKey: 'leave_request_admin',
      tipe: 'cuti_minta_batal',
      pesan: `${emp.nama || 'Karyawan'} meminta pembatalan cuti yang sudah disetujui (${periode}).${alasan ? ` Alasan: ${alasan}` : ''} Buka Kelola Pengajuan Cuti (filter "Permintaan batal") untuk menyetujui atau menolak.`,
      link: '/employee/leave-request/admin?status=minta_batal',
      // Kunci memuat waktu permintaan: permintaan baru setelah ditolak HR tetap
      // memberi tahu HR, sedangkan permintaan ganda ditahan oleh status di atas.
      dedupeKey: `cuti_minta_batal:${row.id}:${sekarang}`,
    });
    if (!notif.ok) {
      console.error('Notifikasi permintaan batal cuti gagal terkirim (permintaan tetap tersimpan):', row.id);
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
        alasan,
        permintaan_ulang: row.minta_batal_status === 'ditolak',
      },
    });

    return NextResponse.json({ success: true, alreadySent: false, request: updated });
  } catch (err) {
    console.error('Minta batal cuti error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
