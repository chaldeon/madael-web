import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';

// Jenis dokumen yang boleh diminta form -> label kode di nomor surat + counter yang dipakai
const JENIS_CONFIG = {
  PRO:    { label: 'MKT', counter: 'GLOBAL' },
  QUO:    { label: 'MKT', counter: 'GLOBAL' },
  PROQUO: { label: 'MKT', counter: 'GLOBAL' },
  AGR:    { label: 'ADM', counter: 'GLOBAL' },
  ADM:    { label: 'ADM', counter: 'GLOBAL' },
  INV:    { label: 'INV', counter: 'INV' },
};

const ROMAWI_BULAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

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

    const config = JENIS_CONFIG[kode_jenis];
    if (!config) {
      return NextResponse.json(
        { error: `Jenis dokumen tidak valid. Harus salah satu dari: ${Object.keys(JENIS_CONFIG).join(', ')}` },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Atomic increment lewat Postgres function — aman dari race condition
    const { data: newNumber, error: rpcError } = await admin.rpc(
      'increment_document_counter',
      { p_counter_kode: config.counter }
    );

    if (rpcError) {
      return NextResponse.json(
        { error: 'Gagal generate nomor surat: ' + rpcError.message },
        { status: 500 }
      );
    }

    const now = new Date();
    const nomorPadded = String(newNumber).padStart(3, '0');
    const bulanRomawi = ROMAWI_BULAN[now.getMonth()];
    const tahun = now.getFullYear();

    const nomorSurat = `${nomorPadded}/${config.label}/MPSI/${bulanRomawi}-${tahun}`;

    return NextResponse.json(
      { success: true, nomor_surat: nomorSurat, kode_jenis, nomor: newNumber },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}