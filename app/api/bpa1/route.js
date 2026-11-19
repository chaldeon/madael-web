import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireBpa1Access } from '@/lib/moduleAccessServer';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { friendlyError } from '@/lib/errorMessage';
import { bacaTahun, TAHUN_MIN, TAHUN_MAX } from '@/lib/bpa1Source';
import { pilihDokumenTerbaruPerKlien, susunDaftarBpa1 } from '@/lib/bpa1Daftar';

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
