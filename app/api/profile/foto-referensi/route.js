import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase-admin';

// POST /api/profile/foto-referensi
// Body JSON: { path, descriptor } — path = lokasi file di bucket
// 'employee-photos' (sudah diupload client langsung ke storage sebelum
// panggil endpoint ini), descriptor = array 128 angka dari face-api.js.
//
// Ditangani lewat API route (bukan update langsung dari client) supaya tidak
// perlu buka RLS UPDATE di tabel employees untuk kolom lain — endpoint ini
// cuma mengizinkan mengubah foto_referensi_url & foto_referensi_descriptor
// milik SENDIRI, tidak ada kolom lain yang bisa diubah lewat sini.
export async function POST(request) {
  try {
    const { path, descriptor } = await request.json();

    if (!path || !Array.isArray(descriptor) || descriptor.length !== 128) {
      return NextResponse.json({ error: 'Data foto referensi tidak valid.' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll() {},
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Belum login.' }, { status: 401 });
    }

    const { data: emp } = await supabase
      .from('employees')
      .select('id')
      .eq('email', user.email)
      .maybeSingle();

    if (!emp) {
      return NextResponse.json({ error: 'Data karyawan tidak ditemukan.' }, { status: 404 });
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('employees')
      .update({
        foto_referensi_url: path,
        foto_referensi_descriptor: descriptor,
      })
      .eq('id', emp.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
