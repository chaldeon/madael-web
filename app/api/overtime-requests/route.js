import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { notifyByModule } from '@/lib/notify';
import { tanggalValid } from '@/lib/leave';
import { todayJakarta } from '@/lib/serverTime';
import { formatTanggal } from '@/lib/leaveServer';
import {
  hitungDurasiMenit, validasiPengajuanLembur, jenisHariUntukTanggal,
  tambahHari, RENTANG_HARI_PENGAJUAN,
} from '@/lib/overtimeRules';
import { ambilHariKerja, periksaPengajuanLembur } from '@/lib/overtimeServer';

// GET /api/overtime-requests
// Riwayat lembur milik sendiri. Tabel overtime_requests tidak punya policy RLS
// untuk browser, jadi semua baca/tulis lewat route server (service role) dan
// hak modul `overtime` dicek manual di sini.
export async function GET() {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['overtime']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const { data, error } = await admin
      .from('overtime_requests')
      .select('*')
      .eq('employee_id', emp.id)
      .order('tanggal', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      console.error('Muat riwayat lembur error:', error);
      return NextResponse.json({ error: 'Gagal memuat riwayat lembur.' }, { status: 500 });
    }

    return NextResponse.json({ requests: data || [] });
  } catch (err) {
    console.error('Muat riwayat lembur error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

// POST /api/overtime-requests   body: { tanggal, jamMulai, jamSelesai, alasan }
// Karyawan mengajukan lembur. Aturan yang dicek di server:
// - tanggal valid, dalam rentang 14 hari ke belakang s.d. 14 hari ke depan (WIB)
// - jam valid, durasi 15 menit – 12 jam (boleh melewati tengah malam), alasan
//   wajib dan maksimal 500 karakter
// - tidak bentrok dengan pengajuan pending/approved lain
// - hari kerja biasa: maks 4 jam/hari dan 18 jam/minggu (lihat overtimeRules)
// employee_id dan jenis_hari TIDAK dipercaya dari body: employee_id dari sesi,
// jenis_hari diturunkan dari jadwal kerja (admin bisa menimpanya saat approve,
// mis. untuk hari libur nasional).
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['overtime']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => ({}));
    const tanggal = body?.tanggal;
    const jamMulai = body?.jamMulai;
    const jamSelesai = body?.jamSelesai;
    const alasan = typeof body?.alasan === 'string' ? body.alasan.trim() : '';

    if (!tanggalValid(tanggal)) {
      return NextResponse.json({ error: 'Tanggal lembur wajib diisi dengan benar.' }, { status: 400 });
    }
    const hariIni = todayJakarta();
    if (tanggal < tambahHari(hariIni, -RENTANG_HARI_PENGAJUAN) || tanggal > tambahHari(hariIni, RENTANG_HARI_PENGAJUAN)) {
      return NextResponse.json(
        { error: `Tanggal lembur hanya boleh dari ${RENTANG_HARI_PENGAJUAN} hari ke belakang sampai ${RENTANG_HARI_PENGAJUAN} hari ke depan dari hari ini.` },
        { status: 400 }
      );
    }

    const pesanInvalid = validasiPengajuanLembur({ jamMulai, jamSelesai, alasan });
    if (pesanInvalid) {
      return NextResponse.json({ error: pesanInvalid }, { status: 400 });
    }
    const durasiMenit = hitungDurasiMenit(jamMulai, jamSelesai);

    const jadwal = await ambilHariKerja(admin, emp.id);
    if (jadwal.error) {
      console.error('Ajukan lembur — jadwal kerja error:', jadwal.error);
      return NextResponse.json({ error: 'Gagal memuat jadwal kerja.' }, { status: 500 });
    }
    const jenisHari = jenisHariUntukTanggal(tanggal, jadwal.hariKerja);

    const masalah = await periksaPengajuanLembur(admin, {
      employeeId: emp.id, tanggal, jamMulai, durasiMenit, jenisHari,
    });
    if (masalah) {
      return NextResponse.json({ error: masalah.message }, { status: masalah.status });
    }

    const { data, error: insertError } = await admin
      .from('overtime_requests')
      .insert([{
        employee_id: emp.id,
        tanggal,
        jam_mulai: `${jamMulai.slice(0, 5)}:00`,
        jam_selesai: `${jamSelesai.slice(0, 5)}:00`,
        durasi_menit: durasiMenit,
        alasan,
        jenis_hari: jenisHari,
        status: 'pending',
      }])
      .select()
      .single();
    if (insertError) {
      console.error('Ajukan lembur error:', insertError);
      return NextResponse.json({ error: 'Gagal mengirim pengajuan lembur. Coba lagi.' }, { status: 500 });
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ajukan_lembur',
      targetTable: 'overtime_requests',
      targetId: data.id,
      detail: { tanggal, jam_mulai: data.jam_mulai, jam_selesai: data.jam_selesai, durasi_menit: durasiMenit, jenis_hari: jenisHari },
    });

    await notifyByModule(admin, {
      moduleKey: 'overtime_admin',
      tipe: 'lembur_diajukan',
      pesan: `${emp.nama || 'Karyawan'} mengajukan lembur ${formatTanggal(tanggal)} (${Number((durasiMenit / 60).toFixed(2))} jam).`,
      link: '/employee/overtime/admin',
    });

    return NextResponse.json({ success: true, request: data }, { status: 201 });
  } catch (err) {
    console.error('Ajukan lembur error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
