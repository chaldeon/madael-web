import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { canAccessJob, checkApplicationScope, OUT_OF_SCOPE_ERROR, requireJobPortalAccess } from '@/lib/jobPortalServer';
import { APPLICATION_STATUSES, normalizeReason } from '@/lib/applicationStatus';
import {
  STATUS_HISTORY_COLUMNS,
  STATUS_HISTORY_MIGRATION_HINT,
  isMissingTableError,
  recordStatusChange,
} from '@/lib/applicationStatusServer';

// GET /api/applications/[id]/status
// Riwayat perubahan status satu pelamar (terbaru di atas).
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    const access = await requireJobPortalAccess(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

    const scopeCheck = await checkApplicationScope(admin, access.scope, id);
    if (scopeCheck.error) return NextResponse.json({ error: scopeCheck.error }, { status: scopeCheck.status });

    const { data, error } = await admin
      .from('application_status_history')
      .select(STATUS_HISTORY_COLUMNS)
      .eq('application_id', id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Muat riwayat status pelamar gagal:', error);
      return NextResponse.json(
        {
          error: isMissingTableError(error)
            ? STATUS_HISTORY_MIGRATION_HINT
            : 'Terjadi kesalahan pada server.',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ history: data || [] });
  } catch (err) {
    console.error('Status history GET unexpected error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}

// PATCH /api/applications/[id]/status   body: { status, reason? }
// Ubah status pelamar. Akses (penuh / reviewer terbatas per lowongan) ditegakkan
// di sini karena service role melewati RLS. Status "Ditolak" wajib beralasan.
// Perubahan hanya diterapkan kalau status di database masih sama dengan yang
// dibaca (dua orang yang mengubah bersamaan tidak saling menimpa diam-diam).
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    const access = await requireJobPortalAccess(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    const { emp, scope } = access;

    const body = await request.json().catch(() => ({}));
    const newStatus = typeof body.status === 'string' ? body.status : '';
    if (!APPLICATION_STATUSES.includes(newStatus)) {
      return NextResponse.json({ error: 'Status tidak valid.' }, { status: 400 });
    }

    // Alasan hanya relevan untuk penolakan; untuk status lain diabaikan.
    const reason = newStatus === 'Ditolak' ? normalizeReason(body.reason) : '';
    if (newStatus === 'Ditolak' && !reason) {
      return NextResponse.json({ error: 'Alasan penolakan wajib diisi.' }, { status: 400 });
    }

    const { data: app, error: lookupError } = await admin
      .from('applications')
      .select('id, nama, job_id, status, job_listings ( title )')
      .eq('id', id)
      .maybeSingle();
    if (lookupError) {
      // 22P02 = id bukan format yang valid untuk kolom id
      if (lookupError.code === '22P02') {
        return NextResponse.json({ error: 'Lamaran tidak ditemukan.' }, { status: 404 });
      }
      throw lookupError;
    }
    if (!app) return NextResponse.json({ error: 'Lamaran tidak ditemukan.' }, { status: 404 });
    if (!canAccessJob(scope, app.job_id)) {
      return NextResponse.json({ error: OUT_OF_SCOPE_ERROR }, { status: 403 });
    }

    if (app.status === newStatus) {
      return NextResponse.json({ success: true, unchanged: true, status: app.status });
    }

    const { data: updated, error: updateError } = await admin
      .from('applications')
      .update({ status: newStatus })
      .eq('id', id)
      .eq('status', app.status)
      .select('id, status')
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      return NextResponse.json(
        { error: 'Status pelamar baru saja diubah orang lain. Muat ulang halaman lalu coba lagi.' },
        { status: 409 }
      );
    }

    const recorded = await recordStatusChange(admin, {
      app,
      fromStatus: app.status,
      toStatus: newStatus,
      reason,
      emp,
    });

    return NextResponse.json({
      success: true,
      status: updated.status,
      entry: recorded.entry || null,
      warning: recorded.error
        ? recorded.missingTable
          ? STATUS_HISTORY_MIGRATION_HINT
          : 'Status berubah, tetapi riwayatnya gagal tersimpan.'
        : null,
    });
  } catch (err) {
    console.error('Status PATCH unexpected error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}
