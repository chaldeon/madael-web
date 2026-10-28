import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getOwnMaster } from '@/lib/profileServer';
import { PROFILE_MASTER_COLUMNS } from '@/lib/profileFields';
import { friendlyError } from '@/lib/errorMessage';

// GET /api/profile/me
//
// Data HR milik akun yang sedang login untuk halaman Profil Saya
// (app/employee/profile): posisi, status, dan field yang boleh diajukan
// perubahannya (alamat, kontak darurat, rekening, NPWP, nomor BPJS).
// Dulu halaman ini membaca employees_master langsung dari browser — termasuk
// gaji_pokok dan tunjangan yang tidak ditampilkan — sehingga aman-tidaknya
// bergantung penuh pada RLS. Sekarang baris dipilih server dari sesi (bukan
// dari parameter klien) dan kolomnya dibatasi di PROFILE_MASTER_COLUMNS.
//
// Respons: { master } — null kalau akun belum terhubung ke data master.
export async function GET() {
  try {
    const admin = createAdminClient();
    const result = await getOwnMaster(admin, PROFILE_MASTER_COLUMNS);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ master: result.master }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return NextResponse.json(
      { error: friendlyError(err, 'Gagal memuat data profil.', { context: 'Muat profil saya' }) },
      { status: 500 }
    );
  }
}
