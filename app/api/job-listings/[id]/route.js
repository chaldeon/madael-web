import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireJobPortalAccess } from '@/lib/jobPortalServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import {
  diffListing,
  normalizeJobListingInput,
  segarkanHalamanKarir,
  simpanDenganSlugUnik,
} from '@/lib/jobListingServer';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/job-listings/[id]   body: { action, ... }
//   'update'     : semua field lowongan (sama dengan POST /api/job-listings)
//   'set_active' : { is_active: boolean } — aktifkan / nonaktifkan
// -> { listing }
//
// Hanya pengelola Job Portal (akses penuh). Nilai "sebelum" untuk audit dibaca
// dari database, bukan dari state halaman, dan cache /karir disegarkan untuk
// slug lama DAN baru.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    const access = await requireJobPortalAccess(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    if (access.scope.level !== 'full') {
      return NextResponse.json(
        { error: 'Hanya pengelola Job Portal yang boleh mengubah lowongan.' },
        { status: 403 }
      );
    }
    const { emp } = access;

    const notFound = () => NextResponse.json({ error: 'Lowongan tidak ditemukan.' }, { status: 404 });
    if (!UUID_RE.test(id)) return notFound();

    const body = await request.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : '';
    if (action !== 'update' && action !== 'set_active') {
      return NextResponse.json({ error: 'Aksi tidak valid.' }, { status: 400 });
    }

    const { data: before, error: beforeError } = await admin
      .from('job_listings')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (beforeError) throw beforeError;
    if (!before) return notFound();

    // ---- Aktifkan / nonaktifkan ----
    if (action === 'set_active') {
      if (typeof body.is_active !== 'boolean') {
        return NextResponse.json({ error: 'Status lowongan tidak valid.' }, { status: 400 });
      }
      const { data, error } = await admin
        .from('job_listings')
        .update({ is_active: body.is_active })
        .eq('id', id)
        .select()
        .maybeSingle();
      if (error) {
        return NextResponse.json(
          { error: `Gagal mengubah status: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Ubah status lowongan' })}` },
          { status: 500 }
        );
      }
      if (!data) return notFound();

      await logActivity(admin, {
        userId: emp.id,
        aksi: 'ubah_status_lowongan',
        targetTable: 'job_listings',
        targetId: data.id,
        detail: {
          judul: data.title,
          slug: data.slug,
          dari: before.is_active ? 'aktif' : 'nonaktif',
          ke: data.is_active ? 'aktif' : 'nonaktif',
        },
      });
      segarkanHalamanKarir([data.slug]);
      return NextResponse.json({ listing: data });
    }

    // ---- Ubah seluruh field ----
    const parsed = normalizeJobListingInput(body, { slugAsli: before.slug });
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await simpanDenganSlugUnik(admin, parsed.slugBase, id, (slug) =>
      admin.from('job_listings').update({ ...parsed.value, slug }).eq('id', id).select().maybeSingle()
    );
    if (error) {
      return NextResponse.json(
        { error: `Gagal menyimpan lowongan: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Ubah lowongan' })}` },
        { status: 500 }
      );
    }
    if (!data) return notFound();

    const perubahan = diffListing(before, data);
    if (Object.keys(perubahan).length > 0) {
      await logActivity(admin, {
        userId: emp.id,
        aksi: 'ubah_lowongan',
        targetTable: 'job_listings',
        targetId: data.id,
        detail: { judul: data.title, slug: data.slug, perubahan },
      });
    }
    segarkanHalamanKarir([data.slug, before.slug]);
    return NextResponse.json({ listing: data });
  } catch (err) {
    console.error('Ubah lowongan:', err);
    return NextResponse.json({ error: 'Gagal menyimpan lowongan.' }, { status: 500 });
  }
}
