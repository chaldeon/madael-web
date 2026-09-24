import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';

// POST /api/attendance/justify
// HR (superadmin) menandai keterlambatan sebagai Justified atau tidak.
// body: { attendanceId, justified: true | false | null }
//   true  -> Justified (badge berubah jadi "Tepat Waktu (Disetujui)")
//   false -> tidak disetujui (badge tetap Telat)
//   null  -> kembalikan ke "belum ditinjau"
// status_telat dan alasan karyawan TIDAK diubah/dihapus — hanya kolom justified*.
// Hanya superadmin, sama seperti approval koreksi absensi.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const attendanceId = body?.attendanceId;
    const justified = body?.justified;

    if (attendanceId === undefined || attendanceId === null || attendanceId === '') {
      return NextResponse.json({ error: 'attendanceId wajib diisi.' }, { status: 400 });
    }
    if (justified !== true && justified !== false && justified !== null) {
      return NextResponse.json({ error: 'justified harus true, false, atau null.' }, { status: 400 });
    }

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

    const { data: requester } = await supabase
      .from('employees')
      .select('id, is_superadmin, status')
      .eq('email', user.email)
      .maybeSingle();

    if (!requester || requester.status !== 'Aktif' || !requester.is_superadmin) {
      return NextResponse.json(
        { error: 'Hanya superadmin yang boleh menandai justified.' },
        { status: 403 }
      );
    }

    const admin = createAdminClient();

    const { data: current } = await admin
      .from('attendance')
      .select('id, employee_id, tanggal, status_telat, justified')
      .eq('id', attendanceId)
      .maybeSingle();

    if (!current) {
      return NextResponse.json({ error: 'Data absensi tidak ditemukan.' }, { status: 404 });
    }
    if (!current.status_telat) {
      return NextResponse.json(
        { error: 'Absensi ini tidak berstatus telat, tidak perlu di-justify.' },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await admin
      .from('attendance')
      .update({
        justified,
        justified_by: justified === null ? null : requester.id,
        justified_at: justified === null ? null : new Date().toISOString(),
      })
      .eq('id', attendanceId)
      .select()
      .single();

    if (updateError) throw updateError;

    await logActivity(admin, {
      userId: requester.id,
      aksi: 'justify_telat',
      targetTable: 'attendance',
      targetId: updated.id,
      detail: {
        employee_id: current.employee_id,
        tanggal: current.tanggal,
        before_justified: current.justified,
        after_justified: justified,
      },
    });

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error('Justify telat error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat menyimpan keputusan.' }, { status: 500 });
  }
}
