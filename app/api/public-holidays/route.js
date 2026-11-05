import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { tahunSekarang } from '@/lib/leave';
import {
  jenisLiburValid, tanggalLiburValid, tahunLiburWajar, tabelLiburBelumAda,
  MAKS_NAMA_LIBUR, MAKS_BARIS_IMPOR_LIBUR, TAHUN_LIBUR_MIN, TAHUN_LIBUR_MAX,
} from '@/lib/publicHolidays';

export const dynamic = 'force-dynamic';

const PESAN_MIGRASI = 'Tabel hari libur belum dibuat di database. Jalankan migrasi supabase/migrations/20261104120000_hari_libur_nasional.sql di Supabase SQL Editor.';

// GET /api/public-holidays?year=2026
// Daftar hari libur nasional & cuti bersama untuk satu tahun (default tahun
// berjalan). Khusus superadmin (modul hari_libur bertanda superadminOnly di
// registry). Halaman lain (cuti, absensi) membaca tabelnya langsung lewat RLS
// (boleh dibaca semua pengguna login), jadi route ini hanya untuk halaman kelola.
export async function GET(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['hari_libur']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const param = new URL(request.url).searchParams.get('year');
    const tahun = param === null ? tahunSekarang() : Number(param);
    if (!Number.isInteger(tahun) || tahun < TAHUN_LIBUR_MIN || tahun > TAHUN_LIBUR_MAX) {
      return NextResponse.json({ error: `Tahun harus antara ${TAHUN_LIBUR_MIN} dan ${TAHUN_LIBUR_MAX}.` }, { status: 400 });
    }

    const { data, error } = await admin
      .from('public_holidays')
      .select('id, tanggal, nama, jenis')
      .gte('tanggal', `${tahun}-01-01`)
      .lte('tanggal', `${tahun}-12-31`)
      .order('tanggal', { ascending: true });
    if (error) {
      if (tabelLiburBelumAda(error)) {
        return NextResponse.json({ error: PESAN_MIGRASI, belumMigrasi: true }, { status: 503 });
      }
      console.error('Muat hari libur error:', error);
      return NextResponse.json(
        { error: `Gagal memuat hari libur: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Muat hari libur' })}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ year: tahun, rows: data || [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('Muat hari libur error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

// Validasi satu item { tanggal, nama, jenis }. Return { value } atau { error }.
function validasiItem(item) {
  if (!item || typeof item !== 'object') return { error: 'Data hari libur tidak valid.' };
  if (!tanggalLiburValid(item.tanggal)) return { error: `Tanggal "${item.tanggal}" tidak valid (format YYYY-MM-DD).` };
  if (!tahunLiburWajar(item.tanggal)) return { error: `Tahun ${String(item.tanggal).slice(0, 4)} di luar rentang ${TAHUN_LIBUR_MIN}–${TAHUN_LIBUR_MAX}.` };
  const nama = typeof item.nama === 'string' ? item.nama.trim() : '';
  if (!nama) return { error: `Nama libur untuk ${item.tanggal} wajib diisi.` };
  if (nama.length > MAKS_NAMA_LIBUR) return { error: `Nama libur maksimal ${MAKS_NAMA_LIBUR} karakter.` };
  const jenis = item.jenis === undefined || item.jenis === null || item.jenis === '' ? 'nasional' : item.jenis;
  if (!jenisLiburValid(jenis)) return { error: 'Jenis libur harus nasional atau cuti_bersama.' };
  return { value: { tanggal: item.tanggal, nama, jenis } };
}

// POST /api/public-holidays
// body: { items: [{ tanggal, nama, jenis? }, ...] }  (1..MAKS_BARIS_IMPOR_LIBUR)
// Tambah satu atau banyak hari libur (impor satu tahun sekaligus memakai jalur
// yang sama). Hanya MENAMBAH: tanggal yang sudah ada dilewati dan dilaporkan,
// tidak ditimpa — mengubah yang sudah ada lewat PATCH /api/public-holidays/[id].
// Semua baris baru masuk dalam satu perintah INSERT (masuk semua atau tidak sama
// sekali). Pengajuan cuti yang sudah disetujui tidak dihitung ulang (lihat
// jumlah_hari di leave_requests); yang masih menunggu memakai libur terbaru.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['hari_libur']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await request.json().catch(() => null);
    const items = body?.items;
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Tidak ada hari libur yang dikirim.' }, { status: 400 });
    }
    if (items.length > MAKS_BARIS_IMPOR_LIBUR) {
      return NextResponse.json({ error: `Maksimal ${MAKS_BARIS_IMPOR_LIBUR} hari libur per permintaan.` }, { status: 400 });
    }

    const valid = [];
    const dobel = new Set();
    for (const item of items) {
      const res = validasiItem(item);
      if (res.error) return NextResponse.json({ error: res.error }, { status: 400 });
      if (dobel.has(res.value.tanggal)) {
        return NextResponse.json({ error: `Tanggal ${res.value.tanggal} muncul lebih dari sekali.` }, { status: 400 });
      }
      dobel.add(res.value.tanggal);
      valid.push(res.value);
    }

    const { data: ada, error: adaError } = await admin
      .from('public_holidays')
      .select('tanggal')
      .in('tanggal', valid.map((v) => v.tanggal));
    if (adaError) {
      if (tabelLiburBelumAda(adaError)) {
        return NextResponse.json({ error: PESAN_MIGRASI, belumMigrasi: true }, { status: 503 });
      }
      console.error('Cek hari libur error:', adaError);
      return NextResponse.json(
        { error: `Gagal memeriksa hari libur: ${friendlyError(adaError, 'terjadi kesalahan pada server.', { context: 'Cek hari libur' })}` },
        { status: 500 }
      );
    }
    const sudahAda = new Set((ada || []).map((r) => String(r.tanggal).slice(0, 10)));
    const baru = valid.filter((v) => !sudahAda.has(v.tanggal));

    if (baru.length === 0) {
      return NextResponse.json(
        { error: 'Semua tanggal sudah ada di daftar. Gunakan Edit untuk mengubahnya.', dilewati: [...sudahAda] },
        { status: 409 }
      );
    }

    const { data: inserted, error: insertError } = await admin
      .from('public_holidays')
      .insert(baru.map((v) => ({ ...v, created_by: access.emp.id })))
      .select('id, tanggal, nama, jenis');
    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json({ error: 'Ada tanggal yang baru saja ditambahkan pihak lain. Muat ulang lalu coba lagi.' }, { status: 409 });
      }
      console.error('Tambah hari libur error:', insertError);
      return NextResponse.json(
        { error: `Gagal menyimpan hari libur: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Tambah hari libur' })}` },
        { status: 500 }
      );
    }

    await logActivity(admin, {
      userId: access.emp.id,
      aksi: inserted.length === 1 ? 'tambah_hari_libur' : 'impor_hari_libur',
      targetTable: 'public_holidays',
      targetId: inserted.length === 1 ? inserted[0].id : null,
      detail: {
        jumlah: inserted.length,
        dilewati: [...sudahAda],
        item: inserted.map((r) => ({ tanggal: r.tanggal, nama: r.nama, jenis: r.jenis })),
      },
    });

    return NextResponse.json({ success: true, ditambah: inserted.length, dilewati: [...sudahAda], rows: inserted });
  } catch (err) {
    console.error('Tambah hari libur error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
