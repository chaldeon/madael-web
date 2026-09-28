import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { logActivity } from '@/lib/activityLog';
import { buildQrPayload } from '@/lib/attendanceQr';

// Kelola QR absensi per lokasi kerja (khusus superadmin, sama dengan tab "Lokasi Kerja").
//
//   GET   -> { nama, qrEnabled, qrVersion, payload }
//              payload = teks yang di-encode jadi gambar QR di browser
//              (kosong kalau QR belum dinyalakan)
//   PATCH -> body { enabled?: boolean, regenerate?: boolean }
//              enabled    : nyalakan / matikan QR untuk lokasi ini
//              regenerate : naikkan qr_version — QR lama langsung tidak berlaku
//
// Tanda tangan dibuat di server (kunci tidak pernah dikirim ke browser).

async function requireSuperadmin() {
  const session = await getSessionEmployee('id, status, is_superadmin');
  if (session.error) return { response: NextResponse.json({ error: session.error }, { status: session.status }) };
  if (!session.emp.is_superadmin) {
    return {
      response: NextResponse.json({ error: 'Hanya superadmin yang boleh mengelola QR absensi.' }, { status: 403 }),
    };
  }
  return { emp: session.emp };
}

function toResponse(loc) {
  return {
    nama: loc.nama,
    qrEnabled: !!loc.qr_enabled,
    qrVersion: loc.qr_version,
    payload: loc.qr_enabled ? buildQrPayload(String(loc.id), loc.qr_version) : null,
  };
}

export async function GET(request, { params }) {
  try {
    const { lokasiId } = await params;
    const auth = await requireSuperadmin();
    if (auth.response) return auth.response;

    const admin = createAdminClient();
    const { data: loc, error } = await admin
      .from('work_locations')
      .select('id, nama, qr_enabled, qr_version')
      .eq('id', lokasiId)
      .maybeSingle();

    if (error) {
      console.error('Baca QR lokasi gagal:', error);
      return NextResponse.json(
        { error: 'QR belum bisa dimuat. Pastikan migrasi database sudah dijalankan.' },
        { status: 503 }
      );
    }
    if (!loc) return NextResponse.json({ error: 'Lokasi tidak ditemukan.' }, { status: 404 });

    return NextResponse.json(toResponse(loc));
  } catch (err) {
    console.error('GET QR absensi error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { lokasiId } = await params;
    const body = await request.json().catch(() => null);
    const hasEnabled = body && typeof body.enabled === 'boolean';
    const regenerate = body?.regenerate === true;
    if (!hasEnabled && !regenerate) {
      return NextResponse.json({ error: 'Kirim enabled (boolean) dan/atau regenerate: true.' }, { status: 400 });
    }

    const auth = await requireSuperadmin();
    if (auth.response) return auth.response;

    const admin = createAdminClient();
    const { data: before, error: readErr } = await admin
      .from('work_locations')
      .select('id, nama, qr_enabled, qr_version')
      .eq('id', lokasiId)
      .maybeSingle();
    if (readErr) {
      console.error('Baca QR lokasi gagal:', readErr);
      return NextResponse.json(
        { error: 'QR belum bisa dimuat. Pastikan migrasi database sudah dijalankan.' },
        { status: 503 }
      );
    }
    if (!before) return NextResponse.json({ error: 'Lokasi tidak ditemukan.' }, { status: 404 });

    const patch = {};
    if (hasEnabled) patch.qr_enabled = body.enabled;
    if (regenerate) patch.qr_version = before.qr_version + 1;

    const { data: after, error } = await admin
      .from('work_locations')
      .update(patch)
      .eq('id', lokasiId)
      .select('id, nama, qr_enabled, qr_version')
      .single();
    if (error) {
      console.error('Ubah QR lokasi gagal:', error);
      return NextResponse.json({ error: 'QR belum bisa diubah.' }, { status: 503 });
    }

    await logActivity(admin, {
      userId: auth.emp.id,
      aksi: regenerate ? 'buat_ulang_qr_absensi' : 'ubah_qr_absensi',
      targetTable: 'work_locations',
      targetId: after.id,
      detail: {
        nama: after.nama,
        before: { qr_enabled: before.qr_enabled, qr_version: before.qr_version },
        after: { qr_enabled: after.qr_enabled, qr_version: after.qr_version },
      },
    });

    return NextResponse.json(toResponse(after));
  } catch (err) {
    console.error('PATCH QR absensi error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server saat mengubah QR.' }, { status: 500 });
  }
}
