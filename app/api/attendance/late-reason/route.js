import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { todayJakarta } from '@/lib/serverTime';
import { MAX_ALASAN_TELAT } from '@/lib/attendanceStatus';

// POST /api/attendance/late-reason
// Karyawan mengirim/mengubah alasan keterlambatan untuk absensi HARI INI.
// body: { alasan: string }
//
// Syarat (semua dicek di server, bukan dipercaya dari browser):
//   - baris attendance hari ini milik pemanggil sendiri
//   - status_telat = true (hasil hitung server saat clock-in, termasuk toleransi)
//   - HR belum menandai justified (setelah ditinjau, alasan dikunci)
// Status telat TIDAK berubah; alasan hanya disimpan bersama data absensi.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const alasan = typeof body?.alasan === 'string' ? body.alasan.trim() : '';
    if (!alasan) {
      return NextResponse.json({ error: 'Alasan tidak boleh kosong.' }, { status: 400 });
    }
    if (alasan.length > MAX_ALASAN_TELAT) {
      return NextResponse.json(
        { error: `Alasan maksimal ${MAX_ALASAN_TELAT} karakter.` },
        { status: 400 }
      );
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

    const { data: emp } = await supabase
      .from('employees')
      .select('id, status')
      .eq('email', user.email)
      .maybeSingle();

    if (!emp || emp.status !== 'Aktif') {
      return NextResponse.json({ error: 'Akun tidak aktif.' }, { status: 403 });
    }

    const admin = createAdminClient();
    const tanggal = todayJakarta();

    // Update bersyarat sekaligus (telat + belum ditinjau) supaya tidak ada
    // celah antara cek dan tulis.
    const { data: updated, error: updateError } = await admin
      .from('attendance')
      .update({ alasan_telat: alasan, alasan_telat_at: new Date().toISOString() })
      .eq('employee_id', emp.id)
      .eq('tanggal', tanggal)
      .eq('status_telat', true)
      .is('justified', null)
      .select()
      .maybeSingle();

    if (updateError) throw updateError;

    if (!updated) {
      const { data: row } = await admin
        .from('attendance')
        .select('status_telat, justified')
        .eq('employee_id', emp.id)
        .eq('tanggal', tanggal)
        .maybeSingle();

      if (!row) {
        return NextResponse.json({ error: 'Belum absen masuk hari ini.' }, { status: 400 });
      }
      if (!row.status_telat) {
        return NextResponse.json({ error: 'Absen masuk hari ini tidak berstatus telat.' }, { status: 400 });
      }
      return NextResponse.json(
        { error: 'Alasan sudah ditinjau HR, jadi tidak bisa diubah lagi.' },
        { status: 409 }
      );
    }

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error('Simpan alasan telat error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat menyimpan alasan.' }, { status: 500 });
  }
}
