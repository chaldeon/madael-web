import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireJobPortalAccess } from '@/lib/jobPortalServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import {
  buatPayloadDuplikat,
  normalizeJobListingInput,
  segarkanHalamanKarir,
  simpanDenganSlugUnik,
} from '@/lib/jobListingServer';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/job-listings
//   buat baru : body = { title, slug, department?, client_industry?, location?, type?,
//               work_mode?, experience_level?, num_positions, salary_min?, salary_max?,
//               show_salary?, description?, requirements?, closes_at?, is_active?, questions? }
//   duplikat  : body = { duplicate_of: <id lowongan sumber> }
//   -> 201 { listing }
//
// Hanya pengelola Job Portal (akses penuh); reviewer terbatas tidak boleh membuat
// lowongan. Slug dibuat unik di server, validasi ditegakkan di sini (bukan hanya
// di form), jejak audit dicatat di server, dan cache halaman /karir disegarkan.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireJobPortalAccess(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    if (access.scope.level !== 'full') {
      return NextResponse.json(
        { error: 'Hanya pengelola Job Portal yang boleh membuat lowongan.' },
        { status: 403 }
      );
    }
    const { emp } = access;

    const body = await request.json().catch(() => ({}));

    // ---- Duplikat ----
    if (body?.duplicate_of !== undefined && body?.duplicate_of !== null) {
      const sourceId = typeof body.duplicate_of === 'string' ? body.duplicate_of : '';
      if (!UUID_RE.test(sourceId)) {
        return NextResponse.json({ error: 'Lowongan sumber tidak ditemukan.' }, { status: 404 });
      }
      const { data: source, error: sourceError } = await admin
        .from('job_listings')
        .select('*')
        .eq('id', sourceId)
        .maybeSingle();
      if (sourceError) throw sourceError;
      if (!source) {
        return NextResponse.json({ error: 'Lowongan sumber tidak ditemukan.' }, { status: 404 });
      }

      const payload = buatPayloadDuplikat(source);
      const { data, error } = await simpanDenganSlugUnik(admin, `${source.slug}-copy`, null, (slug) =>
        admin.from('job_listings').insert([{ ...payload, slug }]).select().single()
      );
      if (error) {
        return NextResponse.json(
          { error: `Gagal menduplikat lowongan: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Duplikat lowongan' })}` },
          { status: 500 }
        );
      }

      await logActivity(admin, {
        userId: emp.id,
        aksi: 'duplikat_lowongan',
        targetTable: 'job_listings',
        targetId: data.id,
        detail: { judul: data.title, slug: data.slug, sumber_id: source.id, sumber_judul: source.title },
      });
      segarkanHalamanKarir([data.slug]);
      return NextResponse.json({ listing: data }, { status: 201 });
    }

    // ---- Buat baru ----
    const parsed = normalizeJobListingInput(body);
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { data, error } = await simpanDenganSlugUnik(admin, parsed.slugBase, null, (slug) =>
      admin.from('job_listings').insert([{ ...parsed.value, slug }]).select().single()
    );
    if (error) {
      return NextResponse.json(
        { error: `Gagal menyimpan lowongan: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Buat lowongan' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'buat_lowongan',
      targetTable: 'job_listings',
      targetId: data.id,
      detail: { judul: data.title, slug: data.slug, aktif: data.is_active, closes_at: data.closes_at },
    });
    segarkanHalamanKarir([data.slug]);
    return NextResponse.json({ listing: data }, { status: 201 });
  } catch (err) {
    console.error('Buat lowongan:', err);
    return NextResponse.json({ error: 'Gagal menyimpan lowongan.' }, { status: 500 });
  }
}
