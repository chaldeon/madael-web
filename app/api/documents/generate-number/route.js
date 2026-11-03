import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';
import { friendlyError } from '@/lib/errorMessage';
import { DOKUMEN_JENIS, ambilNomorDokumen } from '@/lib/documentNumberServer';

export async function POST(request) {
  try {
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
            // no-op — route ini tidak perlu set cookie baru
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum login.' }, { status: 401 });
    }

    // Pastikan requester adalah employee aktif
    const { data: requester } = await supabase
      .from('employees')
      .select('status')
      .eq('email', user.email)
      .maybeSingle();

    if (!requester || requester.status !== 'Aktif') {
      return NextResponse.json({ error: 'Akun employee tidak aktif.' }, { status: 403 });
    }

    const body = await request.json();
    const { kode_jenis } = body;

    const config = DOKUMEN_JENIS[kode_jenis];
    if (!config) {
      return NextResponse.json(
        { error: `Jenis dokumen tidak valid. Harus salah satu dari: ${Object.keys(DOKUMEN_JENIS).join(', ')}` },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Atomic increment lewat Postgres function — aman dari race condition.
    // Format nomor ada di lib/documentNumberServer.js (satu sumber dengan
    // POST /api/documents). Catatan: route ini hanya mengambil nomor; form
    // Dokumen Baru sekarang memakai POST /api/documents supaya nomor tidak
    // hangus kalau insert gagal.
    let nomor;
    try {
      nomor = await ambilNomorDokumen(admin, kode_jenis);
    } catch (rpcError) {
      return NextResponse.json(
        { error: 'Gagal generate nomor surat: ' + friendlyError(rpcError, 'terjadi kesalahan pada server.', { context: 'Generate nomor surat' }) },
        { status: 500 }
      );
    }
    const nomorSurat = nomor.nomor;
    const newNumber = nomor.urutan;

    return NextResponse.json(
      { success: true, nomor_surat: nomorSurat, kode_jenis, nomor: newNumber },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}