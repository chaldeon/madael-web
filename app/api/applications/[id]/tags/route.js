import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { requireJobPortalAccess } from '@/lib/jobPortalServer';
import { MAX_TAGS_PER_CANDIDATE, normalizeTags, parseTagList } from '@/lib/talentPoolTags';

const MIGRATION_HINT =
  'Kolom tags belum ada. Jalankan migrasi SQL scripts/sql/talent_pool_tags.sql di Supabase.';

// PATCH /api/applications/[id]/tags   body: { add?: string | string[], remove?: string | string[] }
// Menambah / menghapus tag kandidat di talent pool (lamaran umum, job_id null).
// Hanya akses penuh Job Portal. Perubahan dihitung di server dari isi database,
// jadi dua HR yang mengedit bersamaan tidak saling menimpa seluruh daftar tag.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    const access = await requireJobPortalAccess(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    const { emp, scope } = access;

    if (scope.level !== 'full') {
      return NextResponse.json(
        { error: 'Tag talent pool hanya untuk akses penuh Job Portal.' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const toAdd = parseTagList(body.add);
    const toRemove = parseTagList(body.remove);
    if (toAdd.length === 0 && toRemove.length === 0) {
      return NextResponse.json({ error: 'Tag tidak boleh kosong.' }, { status: 400 });
    }

    const { data: app, error } = await admin
      .from('applications')
      .select('id, nama, job_id, tags')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      // 22P02 = id bukan format yang valid; 42703 = kolom tags belum dibuat
      if (error.code === '22P02') return NextResponse.json({ error: 'Lamaran tidak ditemukan.' }, { status: 404 });
      console.error('Muat tag pelamar gagal:', error);
      return NextResponse.json(
        { error: error.code === '42703' ? MIGRATION_HINT : 'Terjadi kesalahan pada server.' },
        { status: 500 }
      );
    }
    if (!app) return NextResponse.json({ error: 'Lamaran tidak ditemukan.' }, { status: 404 });
    if (app.job_id) {
      return NextResponse.json(
        { error: 'Tag hanya untuk kandidat di talent pool (lamaran umum).' },
        { status: 400 }
      );
    }

    const current = normalizeTags(app.tags);
    const removeSet = new Set(toRemove);
    const next = current.filter((t) => !removeSet.has(t));
    for (const tag of toAdd) {
      if (!next.includes(tag)) next.push(tag);
    }

    if (next.length > MAX_TAGS_PER_CANDIDATE) {
      return NextResponse.json(
        { error: `Maksimal ${MAX_TAGS_PER_CANDIDATE} tag per kandidat.` },
        { status: 400 }
      );
    }

    const added = next.filter((t) => !current.includes(t));
    const removed = current.filter((t) => !next.includes(t));
    if (added.length === 0 && removed.length === 0) {
      return NextResponse.json({ tags: current });
    }

    const { error: updateError } = await admin.from('applications').update({ tags: next }).eq('id', id);
    if (updateError) {
      console.error('Simpan tag pelamar gagal:', updateError);
      return NextResponse.json(
        { error: updateError.code === 'PGRST204' ? MIGRATION_HINT : 'Gagal menyimpan tag.' },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_tag_pelamar',
      targetTable: 'applications',
      targetId: app.id,
      detail: { nama: app.nama, tambah: added, hapus: removed },
    });

    return NextResponse.json({ tags: next });
  } catch (err) {
    console.error('Tags PATCH unexpected error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}
