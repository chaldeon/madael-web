import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { notifySuperadmins } from '@/lib/notify';

const STATUS_LABEL = {
  approved: 'disetujui',
  rejected: 'ditolak',
  cancelled: 'dibatalkan',
};

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// POST /api/leave-requests/[id]/cancel
// Karyawan membatalkan pengajuan cuti miliknya sendiri yang MASIH pending.
//
// Sengaja lewat route server (service role) dan bukan update langsung dari
// browser: kalau karyawan diberi izin UPDATE di tabel leave_requests lewat RLS,
// dia bisa mengubah status pengajuannya sendiri jadi 'approved'. Di sini yang
// bisa terjadi hanya satu hal: pending -> cancelled, di baris milik sendiri.
//
// Update-nya bersyarat (.eq('status', 'pending')) sehingga atomik terhadap
// superadmin yang menyetujui/menolak di saat yang sama: salah satu yang menang.
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

    const { data: updated, error: updateError } = await admin
      .from('leave_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('employee_id', emp.id)
      .eq('status', 'pending')
      .select('id, tanggal_mulai, tanggal_selesai')
      .maybeSingle();

    if (updateError) {
      console.error('Batalkan cuti error:', updateError);
      return NextResponse.json({ error: 'Gagal membatalkan pengajuan cuti.' }, { status: 500 });
    }

    if (!updated) {
      // Tidak ada baris yang berubah: bukan milik karyawan ini, tidak ada,
      // atau statusnya sudah bukan pending (mis. baru saja disetujui admin).
      const { data: existing } = await admin
        .from('leave_requests')
        .select('status')
        .eq('id', id)
        .eq('employee_id', emp.id)
        .maybeSingle();

      if (!existing) {
        return NextResponse.json({ error: 'Pengajuan cuti tidak ditemukan.' }, { status: 404 });
      }
      return NextResponse.json(
        {
          error: `Pengajuan ini sudah ${STATUS_LABEL[existing.status] || existing.status}, jadi tidak bisa dibatalkan.`,
          status: existing.status,
        },
        { status: 409 }
      );
    }

    // Di-await (bukan fire-and-forget) karena di serverless proses bisa
    // dihentikan begitu response terkirim. Keduanya sudah try/catch sendiri.
    await logActivity(admin, {
      userId: emp.id,
      aksi: 'cancel_cuti',
      targetTable: 'leave_requests',
      targetId: updated.id,
      detail: {
        employee_id: emp.id,
        tanggal_mulai: updated.tanggal_mulai,
        tanggal_selesai: updated.tanggal_selesai,
      },
    });

    // Superadmin sudah diberi tahu saat pengajuan dibuat; beri tahu juga kalau
    // dibatalkan supaya notifikasi lama tidak membingungkan.
    await notifySuperadmins(admin, {
      tipe: 'cuti_dibatalkan',
      pesan: `${emp.nama || 'Karyawan'} membatalkan pengajuan cuti ${formatTanggal(updated.tanggal_mulai)} – ${formatTanggal(updated.tanggal_selesai)}.`,
      link: '/employee/leave-request/admin',
    });

    return NextResponse.json({ success: true, status: 'cancelled' });
  } catch (err) {
    console.error('Batalkan cuti error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}