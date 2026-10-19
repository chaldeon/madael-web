import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireJobPortalAccess } from '@/lib/jobPortalServer';

// Slug dibuat admin lewat slugify() (huruf kecil, angka, tanda hubung). Pola ini
// juga mencegah path aneh masuk ke revalidatePath.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUGS = 10;

// POST /api/job-listings/revalidate  { slugs?: string[] }
// Dipanggil browser setelah lowongan dibuat / diubah / diaktifkan / dinonaktifkan
// / diduplikat, supaya halaman publik yang di-cache (ISR) langsung segar:
// daftar /karir dan detail /karir/[slug] untuk tiap slug yang dikirim (kirim
// slug lama DAN baru kalau slug berubah). Hanya pengelola Job Portal (akses
// penuh) — reviewer terbatas tidak bisa mengubah lowongan.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireJobPortalAccess(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    if (access.scope.level !== 'full') {
      return NextResponse.json(
        { error: 'Hanya pengelola Job Portal yang boleh menyegarkan halaman karir.' },
        { status: 403 }
      );
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      // body kosong/bukan JSON: tetap segarkan daftar saja
    }

    const rawSlugs = Array.isArray(body?.slugs) ? body.slugs : [];
    const slugs = [...new Set(rawSlugs.filter((s) => typeof s === 'string' && SLUG_RE.test(s)))].slice(
      0,
      MAX_SLUGS
    );

    revalidatePath('/karir');
    slugs.forEach((slug) => revalidatePath(`/karir/${slug}`));

    return NextResponse.json({ ok: true, slugs });
  } catch (err) {
    console.error('Revalidate halaman karir:', err);
    return NextResponse.json({ error: 'Gagal menyegarkan halaman karir.' }, { status: 500 });
  }
}
