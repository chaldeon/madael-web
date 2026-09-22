import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';

const STATUS_LABEL = {
  approved: 'disetujui',
  rejected: 'ditolak',
  cancelled: 'dibatalkan',
};

// POST /api/attendance/koreksi/[id]/cancel
// Karyawan membatalkan pengajuan koreksi absensi mandiri miliknya yang MASIH
// pending. Hanya baris yang diajukan sendiri (requested_by = dia) yang bisa
// dibatalkan, jadi catatan koreksi manual buatan admin tidak tersentuh.
//
// Sama seperti pembatalan cuti: lewat service role dengan update bersyarat
// pending -> cancelled, supaya karyawan tidak perlu izin UPDATE di tabel dan
// tidak bisa membatalkan pengajuan yang sudah diproses superadmin.
// Foto bukti di Google Drive sengaja dibiarkan sebagai jejak audit.
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
      .from('attendance_corrections')
      .update({ status: 'cancelled' })
      .eq('id', id)
      .eq('requested_by', emp.id)
      .eq('status', 'pending')
      .select('id, tanggal')
      .maybeSingle();

    if (updateError) {
      console.error('Batalkan koreksi absensi error:', updateError);
      return NextResponse.json({ error: 'Gagal membatalkan pengajuan koreksi.' }, { status: 500 });
    }

    if (!updated) {
      const { data: existing } = await admin
        .from('attendance_corrections')
        .select('status')
        .eq('id', id)
        .eq('requested_by', emp.id)
        .maybeSingle();

      if (!existing) {
        return NextResponse.json({ error: 'Pengajuan koreksi tidak ditemukan.' }, { status: 404 });
      }
      return NextResponse.json(
        {
          error: `Pengajuan ini sudah ${STATUS_LABEL[existing.status] || existing.status}, jadi tidak bisa dibatalkan.`,
          status: existing.status,
        },
        { status: 409 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'cancel_koreksi_absensi',
      targetTable: 'attendance_corrections',
      targetId: updated.id,
      detail: { employee_id: emp.id, tanggal: updated.tanggal },
    });

    return NextResponse.json({ success: true, status: 'cancelled' });
  } catch (err) {
    console.error('Batalkan koreksi absensi error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}