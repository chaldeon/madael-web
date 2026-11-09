import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getApproverContext } from '@/lib/pendingQueueServer';
import { muatIdKaryawanNonaktif, tutupPengajuanNonaktif } from '@/lib/pendingNonaktifServer';

// POST /api/approvals/tutup-nonaktif
// Tutup massal pengajuan PENDING milik karyawan yang sudah nonaktif, pada modul
// antrean yang boleh diakses pemanggil (aturan akses sama dengan Inbox dan badge:
// lib/pendingQueueServer.js — koreksi absensi tetap khusus superadmin).
//
// Tidak ada body. Tidak ada data yang dihapus: baris berubah ke status akhir
// (cuti/lembur/reimbursement/koreksi -> 'cancelled', perubahan profil ->
// 'rejected' + catatan reviewer), tiap baris dicatat di Activity Log dengan aksi
// tutup_pengajuan_nonaktif. Karyawan nonaktif tidak dinotifikasi. Cuti disetujui
// yang diminta batal tidak ikut ditutup (hanya status 'pending').
// Respons: { success, total, rincian: [{ key, jenis, jumlah }], gagal: [jenis] }.
export async function POST() {
  try {
    const admin = createAdminClient();
    const ctx = await getApproverContext(admin);
    if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { emp, keys } = ctx;

    if (keys.length === 0) {
      return NextResponse.json({ error: 'Anda tidak punya akses ke fitur ini.' }, { status: 403 });
    }

    let nonaktifIds;
    try {
      nonaktifIds = await muatIdKaryawanNonaktif(admin);
    } catch (nonaktifError) {
      console.error('Muat karyawan nonaktif tutup massal error:', nonaktifError);
      return NextResponse.json({ error: 'Gagal memuat daftar karyawan nonaktif. Coba lagi.' }, { status: 500 });
    }

    if (nonaktifIds.length === 0) {
      return NextResponse.json({ success: true, total: 0, rincian: [], gagal: [] });
    }

    const hasil = await tutupPengajuanNonaktif(admin, { approverId: emp.id, keys, nonaktifIds });

    if (hasil.total === 0 && hasil.gagal.length > 0) {
      return NextResponse.json(
        { error: `Gagal menutup pengajuan (${hasil.gagal.join(', ')}). Coba lagi.` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, ...hasil });
  } catch (err) {
    console.error('Tutup pengajuan nonaktif error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
