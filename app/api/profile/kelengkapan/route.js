import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getOwnMaster } from '@/lib/profileServer';
import { EMPLOYEE_COMPLETENESS_COLUMNS, missingFieldsForEmployee } from '@/lib/dataCompleteness';
import { friendlyError } from '@/lib/errorMessage';

// GET /api/profile/kelengkapan
//
// Ringkasan kelengkapan Profil Saya untuk titik pengingat di dashboard.
// Dashboard cuma butuh tahu "ada yang belum lengkap atau tidak", jadi
// kelengkapan dihitung di server dan yang dikirim hanya angkanya — nomor
// rekening, NPWP, dan BPJS tidak ikut ke browser lewat halaman dashboard.
//
// Respons: { terhubung: boolean, kurang: number }
export async function GET() {
  try {
    const admin = createAdminClient();
    const result = await getOwnMaster(admin, EMPLOYEE_COMPLETENESS_COLUMNS);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const kurang = missingFieldsForEmployee(result.master).length;
    return NextResponse.json(
      { terhubung: !!result.master, kurang },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: friendlyError(err, 'Gagal memuat kelengkapan profil.', { context: 'Muat kelengkapan profil' }) },
      { status: 500 }
    );
  }
}
