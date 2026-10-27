import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';

// GET /api/attendance/foto-referensi/[employeeId]
// Menyajikan foto referensi wajah karyawan (bucket 'employee-photos') untuk panel
// review absensi, supaya admin bisa membandingkannya berdampingan dengan foto absen.
// Foto absen sendiri dilayani /api/attendance/foto/[id].
//
// Hanya superadmin — sama dengan panel review dan route foto absen. Path file dibaca
// dari kolom employees.foto_referensi_url di server, bukan dari input klien, jadi
// route ini tidak bisa dipakai membaca file lain di bucket.
export async function GET(request, { params }) {
  try {
    const { employeeId } = await params;
    if (typeof employeeId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(employeeId)) {
      return NextResponse.json({ error: 'ID karyawan tidak valid.' }, { status: 400 });
    }

    const session = await getSessionEmployee('id, status, is_superadmin');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    if (!session.emp.is_superadmin) {
      return NextResponse.json({ error: 'Hanya superadmin yang boleh melihat foto referensi.' }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data: target, error: lookupError } = await admin
      .from('employees')
      .select('foto_referensi_url')
      .eq('id', employeeId)
      .maybeSingle();
    if (lookupError && lookupError.code !== '22P02') throw lookupError; // 22P02 = format ID salah -> 404
    if (!target?.foto_referensi_url) {
      return NextResponse.json({ error: 'Foto referensi tidak ditemukan.' }, { status: 404 });
    }

    const { data: blob, error: downloadError } = await admin.storage
      .from('employee-photos')
      .download(target.foto_referensi_url);
    if (downloadError || !blob) {
      return NextResponse.json({ error: 'Foto referensi tidak ditemukan.' }, { status: 404 });
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    // Hanya jenis gambar yang dikenal; selain itu paksa jpeg + nosniff supaya browser
    // tidak menafsirkan isi file sebagai HTML/skrip.
    const contentType = /^image\/(jpeg|png)$/.test(blob.type) ? blob.type : 'image/jpeg';
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        // Path referensi selalu sama (<id>/reference.jpg, di-upsert), jadi cache pendek.
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('Foto referensi proxy error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat membaca foto referensi.' }, { status: 500 });
  }
}
