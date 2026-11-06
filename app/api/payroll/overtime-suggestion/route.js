import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { hitungSaranLembur } from '@/lib/payroll/overtimeSuggestion';

// GET /api/payroll/overtime-suggestion?periode=YYYY-MM
// SARAN nominal Overtime untuk Payroll Run dari lembur yang sudah disetujui
// pada periode itu. Tidak menulis apa pun ke payroll — halaman Payroll Run
// hanya mengisi kolom edit di layar, dan admin tetap menyimpannya sendiri.
//
// Perhitungan ada di lib/payroll/overtimeSuggestion.js (dipakai juga oleh
// PATCH /api/payroll/runs/[runId]/items yang menyimpan saran ke semua item).
// Hanya angka hasil yang dikirim; gaji pokok/tunjangan tidak ikut di respons.
export async function GET(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const periode = new URL(request.url).searchParams.get('periode') || '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periode)) {
      return NextResponse.json({ error: 'Format periode harus YYYY-MM.' }, { status: 400 });
    }
    const hasil = await hitungSaranLembur(admin, periode);
    if (hasil.error) {
      return NextResponse.json({ error: hasil.error }, { status: 500 });
    }

    // Hanya angka hasil yang dikirim (tanpa client_id internal).
    const suggestions = hasil.suggestions.map(({ client_id: _clientId, ...sug }) => sug);
    const tidakTerhubung = hasil.tidakTerhubung;

    return NextResponse.json({ periode, suggestions, tidak_terhubung: tidakTerhubung });
  } catch (err) {
    console.error('Saran lembur payroll error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
