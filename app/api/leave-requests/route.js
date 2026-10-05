import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { hitungHariKerja, hitungSisaCuti, tahunSekarang, tahunDariTanggal, tanggalValid } from '@/lib/leave';
import { ambilKonteksCuti, cariCutiBentrok, formatTanggal } from '@/lib/leaveServer';

const MAKS_ALASAN = 500;

// POST /api/leave-requests
// Karyawan mengajukan cuti. Dulu insert langsung dari browser tanpa validasi
// server; sekarang semua aturan dicek di sini:
// - tanggal valid, selesai >= mulai, alasan terisi (maks 500 karakter)
// - rentang harus di tahun berjalan dan tidak lintas tahun, karena kuota di
//   employees_master hanya melacak satu tahun
// - minimal 1 hari kerja menurut jadwal employee
// - tidak bentrok dengan pengajuan lain yang pending/approved
// - tidak melebihi sisa kuota (dikurangi pengajuan pending lain tahun ini)
// employee_id selalu diambil dari sesi, bukan dari body.
export async function POST(request) {
  try {
    const session = await getSessionEmployee('id, nama, status');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { emp } = session;

    const body = await request.json().catch(() => ({}));
    const tanggalMulai = body?.tanggalMulai;
    const tanggalSelesai = body?.tanggalSelesai;
    const alasan = typeof body?.alasan === 'string' ? body.alasan.trim() : '';

    if (!tanggalValid(tanggalMulai) || !tanggalValid(tanggalSelesai)) {
      return NextResponse.json({ error: 'Tanggal mulai dan tanggal selesai wajib diisi dengan benar.' }, { status: 400 });
    }
    if (tanggalSelesai < tanggalMulai) {
      return NextResponse.json({ error: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' }, { status: 400 });
    }
    if (!alasan) {
      return NextResponse.json({ error: 'Alasan cuti wajib diisi.' }, { status: 400 });
    }
    if (alasan.length > MAKS_ALASAN) {
      return NextResponse.json({ error: `Alasan maksimal ${MAKS_ALASAN} karakter.` }, { status: 400 });
    }

    const tahun = tahunSekarang();
    if (tahunDariTanggal(tanggalMulai) !== tahun || tahunDariTanggal(tanggalSelesai) !== tahun) {
      return NextResponse.json(
        { error: `Pengajuan cuti hanya untuk tahun ${tahun} dan tidak boleh lintas tahun. Pisahkan jadi pengajuan per tahun.` },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    const ctx = await ambilKonteksCuti(admin, emp.id);
    if (ctx.error) {
      console.error('Ajukan cuti — konteks error:', ctx.error);
      return NextResponse.json({ error: `Gagal memuat data cuti: ${ctx.error.message}` }, { status: 500 });
    }

    const jumlahHari = hitungHariKerja(tanggalMulai, tanggalSelesai, ctx.hariKerja);
    if (jumlahHari === 0) {
      return NextResponse.json(
        { error: 'Rentang tanggal yang dipilih tidak ada hari kerja (semua jatuh di hari libur).' },
        { status: 400 }
      );
    }

    const { error: bentrokError, bentrok } = await cariCutiBentrok(admin, {
      employeeId: emp.id,
      tanggalMulai,
      tanggalSelesai,
    });
    if (bentrokError) {
      return NextResponse.json({ error: `Gagal memeriksa pengajuan lain: ${bentrokError.message}` }, { status: 500 });
    }
    if (bentrok) {
      return NextResponse.json(
        {
          error: `Tanggalnya bentrok dengan pengajuan cuti ${bentrok.status === 'approved' ? 'yang sudah disetujui' : 'yang masih menunggu'} (${formatTanggal(bentrok.tanggal_mulai)} – ${formatTanggal(bentrok.tanggal_selesai)}).`,
        },
        { status: 409 }
      );
    }

    // Kuota hanya bisa dicek kalau akun sudah di-link ke employees_master.
    // Kalau belum, pengajuan tetap diterima (perilaku lama) dan admin
    // mendapat peringatan saat menyetujui.
    if (ctx.master) {
      const { sisa } = hitungSisaCuti(ctx.master, tahun);

      const { data: pendingRows, error: pendingError } = await admin
        .from('leave_requests')
        .select('tanggal_mulai, tanggal_selesai')
        .eq('employee_id', emp.id)
        .eq('status', 'pending')
        .gte('tanggal_mulai', `${tahun}-01-01`)
        .lte('tanggal_mulai', `${tahun}-12-31`);
      if (pendingError) {
        return NextResponse.json({ error: `Gagal memeriksa kuota: ${pendingError.message}` }, { status: 500 });
      }

      const hariPending = (pendingRows || []).reduce(
        (sum, r) => sum + hitungHariKerja(r.tanggal_mulai, r.tanggal_selesai, ctx.hariKerja),
        0
      );
      const tersedia = Math.max(0, sisa - hariPending);

      if (jumlahHari > tersedia) {
        const catatan = hariPending > 0 ? ` (${hariPending} hari sudah dipakai pengajuan lain yang menunggu persetujuan)` : '';
        return NextResponse.json(
          { error: `Pengajuan ${jumlahHari} hari kerja melebihi sisa kuota cuti: tersedia ${tersedia} hari${catatan}.` },
          { status: 400 }
        );
      }
    }

    const { data, error: insertError } = await admin
      .from('leave_requests')
      .insert([{
        employee_id: emp.id,
        tanggal_mulai: tanggalMulai,
        tanggal_selesai: tanggalSelesai,
        alasan,
        status: 'pending',
      }])
      .select()
      .single();

    if (insertError) {
      console.error('Ajukan cuti error:', insertError);
      return NextResponse.json({ error: `Gagal mengirim pengajuan cuti: ${insertError.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, request: data, jumlahHari }, { status: 201 });
  } catch (err) {
    console.error('Ajukan cuti error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
