import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireBpa1Access } from '@/lib/moduleAccessServer';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { bacaTahun, TAHUN_MIN, TAHUN_MAX } from '@/lib/bpa1Source';
import { pilihDokumenTerbaruPerKlien, susunDaftarBpa1 } from '@/lib/bpa1Daftar';
import {
  AKSI_BUAT_BPA1,
  TABEL_DOKUMEN_BPA1,
  bacaBodyBuatBpa1,
  cariKlien,
  cariDokumenKlienTahun,
  buatHeaderDraft,
} from '@/lib/bpa1Server';

// GET /api/bpa1?tahun=YYYY   (BPA-04)
//
// Daftar BPA1 untuk Tool BPA1 (Bukti Potong A1 tahunan): SATU baris per klien
// (tabel companies) untuk tahun pajak yang dipilih — status dan nomor versi
// dokumennya, atau 'Belum dibuat', plus jumlah karyawan. Read-only; tidak
// menulis ke tabel apa pun dan tidak menyentuh Payroll Run/Payslip/Payroll
// Manager.
//
// Akses: requireBpa1Access (BPA-02) — 401/403 dari helper dikirim apa adanya.
// `tahun` wajib dan divalidasi (4 digit, 2000–2100); salah/hilang -> 400.
//
// Respons 200:
//   { data: { tahun, klien: [{
//       client_id, nama_perusahaan,
//       ada_dokumen,            // boolean
//       document_id,            // null bila belum dibuat
//       status,                 // 'Draft' | 'Review' | 'Final' | 'Belum dibuat'
//       versi,                  // null bila belum dibuat
//       is_provisional,         // null bila belum dibuat
//       jumlah_karyawan,
//       sumber_jumlah,          // 'dokumen' | 'employees_master' (lihat bawah)
//   }] } }
//
// Bila satu klien punya beberapa versi untuk tahun itu, yang tampil versi
// tertinggi.
//
// Jumlah karyawan (tanpa angka tetap):
//   - dokumen ada       -> jumlah baris bpa1_items dokumen yang ditampilkan
//                          (sumber yang sama dengan halaman hasil/detail);
//   - dokumen belum ada -> jumlah employees_master klien tersebut (sama dengan
//                          hitungan halaman Payroll Run). Ini perkiraan; field
//                          `sumber_jumlah` menandai asalnya agar UI tidak
//                          menyajikannya seolah angka final.
//
// Tidak ada NIK/NPWP/rekening/nama karyawan yang dibaca atau dikembalikan:
// employees_master hanya dibaca kolom id + client_id.
//
// ASUMSI / BELUM DIUJI TERHADAP DB NYATA: tabel bpa1_documents dan bpa1_items
// adalah USULAN BPA-01 (draf: docs/bpa1/20261119120000_bpa1_skema_USULAN.sql)
// dan belum diterapkan. Bila tabelnya belum ada, rute menjawab 503 dengan
// `belumMigrasi: true` (pola yang sama dengan public-holidays).
// Kebijakan akses per klien (K-08) belum diputuskan: saat ini hak modul global.

const PESAN_BELUM_MIGRASI =
  'Tabel BPA1 belum dibuat di database (migrasi BPA-01 belum diterapkan).';

function tabelBelumAda(error) {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205');
}

function jawabError(error, context) {
  if (tabelBelumAda(error)) {
    console.error(`${context}:`, error);
    return NextResponse.json({ error: PESAN_BELUM_MIGRASI, belumMigrasi: true }, { status: 503 });
  }
  return NextResponse.json(
    { error: `Gagal memuat daftar BPA1: ${friendlyError(error, 'terjadi kesalahan pada server.', { context })}` },
    { status: 500 }
  );
}

// id dokumen dipecah per 100 supaya URL query .in() tidak kepanjangan
// (pola yang sama dengan pisahAkunNonaktif di lib/payrollRunServer.js).
const UKURAN_CHUNK = 100;

export async function GET(request) {
  try {
    const admin = createAdminClient();
    const access = await requireBpa1Access(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const tahun = bacaTahun(new URL(request.url).searchParams.get('tahun'));
    if (tahun === null) {
      return NextResponse.json(
        { error: `Tahun tidak valid (harus 4 digit antara ${TAHUN_MIN}–${TAHUN_MAX}).` },
        { status: 400 }
      );
    }

    // fetchAllRows: PostgREST memotong diam-diam di 1.000 baris.
    const [companiesRes, documentsRes, mastersRes] = await Promise.all([
      fetchAllRows(() => admin.from('companies').select('id, nama_perusahaan').order('nama_perusahaan')),
      fetchAllRows(() =>
        admin
          .from('bpa1_documents')
          .select('id, client_id, tahun_pajak, versi, status, is_provisional')
          .eq('tahun_pajak', tahun)
      ),
      fetchAllRows(() => admin.from('employees_master').select('id, client_id')),
    ]);
    if (companiesRes.error) return jawabError(companiesRes.error, 'Muat companies untuk daftar BPA1');
    if (documentsRes.error) return jawabError(documentsRes.error, 'Muat bpa1_documents untuk daftar BPA1');
    if (mastersRes.error) return jawabError(mastersRes.error, 'Muat employees_master untuk daftar BPA1');

    // Item hanya dihitung untuk dokumen yang ditampilkan (versi terbaru).
    const idDokumenTampil = [...pilihDokumenTerbaruPerKlien(documentsRes.data).values()].map((d) => d.id);
    const itemRows = [];
    for (let i = 0; i < idDokumenTampil.length; i += UKURAN_CHUNK) {
      const chunk = idDokumenTampil.slice(i, i + UKURAN_CHUNK);
      const itemsRes = await fetchAllRows(() =>
        admin.from('bpa1_items').select('id, document_id').in('document_id', chunk)
      );
      if (itemsRes.error) return jawabError(itemsRes.error, 'Muat bpa1_items untuk daftar BPA1');
      itemRows.push(...itemsRes.data);
    }

    const klien = susunDaftarBpa1({
      companies: companiesRes.data,
      documents: documentsRes.data,
      itemRows,
      masterRows: mastersRes.data,
    });

    return NextResponse.json({ data: { tahun, klien } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('GET /api/bpa1:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

// POST /api/bpa1   body: { client_id, tahun }   (BPA-06)
//
// Membuat dokumen BPA1 baru berstatus Draft v1 untuk satu klien + tahun pajak.
// Pola mengikuti POST /api/payroll/runs: akses dicek di server, masukan
// divalidasi, duplikat -> 409, pelanggaran unique (23505) -> 409, log dicatat
// dari server.
//
//  - 401/403: dari requireBpa1Access (hak modul 'payroll' + 'bpa1').
//  - 400    : client_id atau tahun tidak valid.
//  - 404    : klien tidak ada di companies.
//  - 409    : sudah ada dokumen BPA1 untuk klien + tahun itu (code
//             BPA1_SUDAH_ADA). Dokumen apa pun yang sudah ada memblokir; versi
//             berikutnya adalah pembetulan (BPA-26), bukan endpoint ini.
//  - 201    : { success: true, dokumen, jumlah_item }.
//
// `created_by` selalu id karyawan dari sesi; tidak pernah dibaca dari body.
// Penandatangan (K-16) belum diputuskan: body tidak menerimanya dan tidak ada
// kolom penandatangan yang ditulis.
//
// BELUM LENGKAP SAMPAI BPA-09: endpoint ini baru membuat HEADER. Snapshot
// bulanan dari Payroll Run (dan rollback header bila snapshot gagal) dipasang
// BPA-09 pada titik bertanda di bawah. Sebelum itu `jumlah_item` selalu 0 dan
// dokumen yang terbentuk tidak punya item. Jangan dipanggil dari UI/produksi
// sebelum BPA-09 ikut dirilis.
//
// ASUMSI / BELUM DIUJI TERHADAP DB NYATA: kolom bpa1_documents yang ditulis
// (client_id, tahun_pajak, versi, status, created_by) adalah USULAN; lihat
// catatan di lib/bpa1Server.js.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireBpa1Access(admin);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => ({}));
    const parsed = bacaBodyBuatBpa1(body);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { clientId, tahun } = parsed.value;

    const jawabGagal = (error, context, pesan) => {
      if (tabelBelumAda(error)) {
        console.error(`${context}:`, error);
        return NextResponse.json({ error: PESAN_BELUM_MIGRASI, belumMigrasi: true }, { status: 503 });
      }
      return NextResponse.json(
        { error: `${pesan}: ${friendlyError(error, 'terjadi kesalahan pada server.', { context })}` },
        { status: 500 }
      );
    };

    const { data: klien, error: klienError } = await cariKlien(admin, clientId);
    if (klienError) return jawabGagal(klienError, 'Muat klien untuk Buat BPA1', 'Gagal memuat klien');
    if (!klien) {
      return NextResponse.json({ error: 'Klien tidak ditemukan.' }, { status: 404 });
    }

    const jawabDuplikat = (existing) =>
      NextResponse.json(
        {
          error: `Dokumen BPA1 untuk klien "${klien.nama_perusahaan}" tahun pajak ${tahun} sudah ada.`,
          code: 'BPA1_SUDAH_ADA',
          document_id: existing?.id || null,
          versi: existing?.versi ?? null,
          status: existing?.status ?? null,
        },
        { status: 409 }
      );

    const { data: existing, error: cekError } = await cariDokumenKlienTahun(admin, clientId, tahun);
    if (cekError) {
      return jawabGagal(cekError, 'Cek dokumen BPA1 yang sudah ada', 'Gagal memeriksa dokumen BPA1');
    }
    if (existing) return jawabDuplikat(existing);

    const { data: dokumen, error: buatError } = await buatHeaderDraft(admin, {
      clientId,
      tahun,
      createdBy: emp.id,
    });
    if (buatError) {
      // 23505 = unique violation: dua admin membuat dokumen yang sama bersamaan.
      if (buatError.code === '23505') {
        const { data: dup } = await cariDokumenKlienTahun(admin, clientId, tahun);
        return jawabDuplikat(dup);
      }
      return jawabGagal(buatError, 'Buat header BPA1', 'Gagal membuat dokumen BPA1');
    }

    // >>> BPA-09: snapshot bulanan dipasang DI SINI (loadBpa1Sumber -> insert
    // snapshot). Bila gagal, hapus header yang baru dibuat (pola rollback
    // runs/route.js:150-159) dan jawab 500 — tidak boleh ada dokumen tanpa
    // snapshot. Sampai itu ada, jumlah item = 0.
    const jumlahItem = 0;

    // Detail log sengaja minimal: klien, tahun, versi, jumlah item. Tanpa
    // NIK/NPWP/rekening/nama karyawan.
    await logActivity(admin, {
      userId: emp.id,
      aksi: AKSI_BUAT_BPA1,
      targetTable: TABEL_DOKUMEN_BPA1,
      targetId: dokumen.id,
      detail: {
        klien: klien.nama_perusahaan,
        tahun,
        versi: dokumen.versi,
        jumlah_item: jumlahItem,
      },
    });

    return NextResponse.json({ success: true, dokumen, jumlah_item: jumlahItem }, { status: 201 });
  } catch (err) {
    console.error('POST /api/bpa1:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
