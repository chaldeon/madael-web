import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { todayJakarta } from '@/lib/serverTime';
import { getBreakState } from '@/lib/attendanceBreak';

// POST /api/attendance/break
// Karyawan memulai / mengakhiri istirahat untuk absensi HARI INI.
// body: { action: 'start' | 'end' }
//
// Sengaja lebih ringan dari clock in/out: TANPA foto, wajah, GPS/geofence, atau QR
// (istirahat memang boleh di luar lokasi kerja). Yang dijaga cuma urutan dan jamnya:
// jam dicatat DI SINI (jam server), bukan dipercaya dari browser.
//
// Aturan (semua dicek di server):
//   - start : sudah clock in, belum clock out, belum pernah istirahat hari ini
//   - end   : sedang istirahat (sudah start, belum end)
//   - satu istirahat per hari
// Clock out saat masih istirahat diblokir di lib/attendanceClock.js (precheckClock).
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const action = body?.action;
    if (action !== 'start' && action !== 'end') {
      return NextResponse.json({ error: 'action harus "start" atau "end".' }, { status: 400 });
    }

    const session = await getSessionEmployee('id, status');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { emp } = session;

    const admin = createAdminClient();
    const now = new Date();
    const tanggal = todayJakarta(now);

    const { data: row, error: readError } = await admin
      .from('attendance')
      .select('*')
      .eq('employee_id', emp.id)
      .eq('tanggal', tanggal)
      .maybeSingle();
    if (readError) throw readError;

    const state = getBreakState(row);

    if (action === 'start') {
      if (state === 'belum_masuk') {
        return NextResponse.json({ error: 'Belum absen masuk hari ini.' }, { status: 400 });
      }
      if (state === 'sudah_pulang') {
        return NextResponse.json(
          { error: 'Kamu sudah absen pulang, istirahat tidak bisa dimulai.' },
          { status: 409 }
        );
      }
      if (state === 'sedang') {
        return NextResponse.json({ error: 'Kamu sudah memulai istirahat.' }, { status: 409 });
      }
      if (state === 'selesai') {
        return NextResponse.json({ error: 'Istirahat hari ini sudah selesai.' }, { status: 409 });
      }

      // Update bersyarat (belum istirahat + belum clock out) supaya dua request yang
      // mendarat bersamaan, atau clock out yang menyelip, tidak menimpa satu sama lain.
      const { data, error } = await admin
        .from('attendance')
        .update({ break_start: now.toISOString() })
        .eq('id', row.id)
        .is('break_start', null)
        .is('clock_out', null)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return NextResponse.json(
          { error: 'Istirahat tidak bisa dimulai. Muat ulang halaman lalu coba lagi.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ data });
    }

    // action === 'end'
    if (state === 'belum_masuk') {
      return NextResponse.json({ error: 'Belum absen masuk hari ini.' }, { status: 400 });
    }
    if (state === 'selesai') {
      return NextResponse.json({ error: 'Istirahat sudah diakhiri.' }, { status: 409 });
    }
    if (state !== 'sedang') {
      return NextResponse.json({ error: 'Kamu belum memulai istirahat.' }, { status: 400 });
    }

    const { data, error } = await admin
      .from('attendance')
      .update({ break_end: now.toISOString() })
      .eq('id', row.id)
      .not('break_start', 'is', null)
      .is('break_end', null)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: 'Istirahat sudah diakhiri.' }, { status: 409 });
    }
    return NextResponse.json({ data });
  } catch (err) {
    console.error('Break in/out error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat menyimpan istirahat.' }, { status: 500 });
  }
}
