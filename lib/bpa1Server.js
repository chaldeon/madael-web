import { idBentukValid } from '@/lib/payrollRunServer';
import { bacaTahun, TAHUN_MIN, TAHUN_MAX } from '@/lib/bpa1Source';

// SERVER ONLY — logika pembuatan dokumen BPA1 (Bukti Potong A1 tahunan per
// klien) untuk POST /api/bpa1 (BPA-06).
//
// OTORISASI BUKAN TUGAS FILE INI. `admin` WAJIB client service role
// (createAdminClient()) sehingga RLS tidak berlaku; pemanggil harus lebih dulu
// lolos requireBpa1Access(admin) dari lib/moduleAccessServer.js.
//
// Cakupan BPA-06: header dokumen Draft v1. Snapshot bulanan dari Payroll Run
// BUKAN di sini (BPA-09); tidak ada kalkulasi pajak (BPA-14/15) dan tidak ada
// pemetaan komponen pajak (BPA-10).
//
// ASUMSI / BELUM DIUJI TERHADAP DB NYATA: skema DB tidak ada di repo (OPS-08).
// Tabel BPA-01 dibuat langsung di Supabase menurut keterangan Andreas, tanpa
// berkas SQL di repo. Yang dipakai di sini hanyalah USULAN, bukan fakta
// tervalidasi:
//  - bpa1_documents: id, client_id, tahun_pajak, versi, status, created_by
//    (id/client_id/tahun_pajak/versi/status sudah dipakai GET /api/bpa1;
//    `created_by` berasal dari kriteria BPA-06 dan belum pernah dibaca kode lain).
//  - status awal 'Draft' termasuk nilai yang diizinkan (Draft/Review/Final).
//  - kolom lain (is_provisional, reviewer, waktu final, dst.) tidak diisi dan
//    diasumsikan nullable atau punya default DB. Bila ternyata NOT NULL tanpa
//    default, insert gagal 500 dan hasilnya terlihat di log server.
//  - penandatangan (K-16) belum diputuskan: TIDAK ditulis sama sekali — tidak
//    ada kolom, sumber, atau format yang dikarang di sini.

export const AKSI_BUAT_BPA1 = 'buat_bpa1';
export const TABEL_DOKUMEN_BPA1 = 'bpa1_documents';
export const STATUS_DOKUMEN_AWAL = 'Draft';
export const VERSI_DOKUMEN_AWAL = 1;

// Validasi body POST. MURNI (tanpa DB). Return { value: { clientId, tahun } }
// atau { error: pesan } untuk dijawab 400.
export function bacaBodyBuatBpa1(body) {
  const clientId = typeof body?.client_id === 'string' ? body.client_id : '';
  if (!idBentukValid(clientId)) return { error: 'Klien tidak valid.' };

  // Angka atau string 4 digit diterima (bacaTahun); selain itu ditolak.
  const tahun = bacaTahun(body?.tahun);
  if (tahun === null) {
    return { error: `Tahun tidak valid (harus 4 digit antara ${TAHUN_MIN}–${TAHUN_MAX}).` };
  }
  return { value: { clientId, tahun } };
}

// Klien dari tabel companies (pola yang sama dengan POST /api/payroll/runs).
// Return { data, error }: data = { id, nama_perusahaan } atau null bila klien
// tidak ada. Id yang bentuknya ditolak Postgres (22P02) dianggap tidak ada,
// bukan error server.
export async function cariKlien(admin, clientId) {
  const { data, error } = await admin
    .from('companies')
    .select('id, nama_perusahaan')
    .eq('id', clientId)
    .maybeSingle();
  if (error) {
    if (error.code === '22P02') return { data: null, error: null };
    return { data: null, error };
  }
  return { data: data || null, error: null };
}

// Dokumen BPA1 yang SUDAH ADA untuk klien + tahun pajak (versi tertinggi).
// Aturan "satu dokumen aktif per klien+tahun": BPA-06 hanya membuat v1, jadi
// dokumen apa pun yang sudah ada (versi/status berapa pun) memblokir. Versi
// berikutnya lewat jalur pembetulan (BPA-26), bukan endpoint ini.
// Return { data, error }: data = { id, versi, status } atau null.
export async function cariDokumenKlienTahun(admin, clientId, tahun) {
  const { data, error } = await admin
    .from(TABEL_DOKUMEN_BPA1)
    .select('id, versi, status')
    .eq('client_id', clientId)
    .eq('tahun_pajak', tahun)
    .order('versi', { ascending: false })
    .limit(1);
  if (error) return { data: null, error };
  return { data: data?.[0] || null, error: null };
}

// Insert header Draft v1. `createdBy` WAJIB id karyawan dari sesi server
// (requireBpa1Access -> emp.id), TIDAK PERNAH dari body request.
// Return { data, error }; pelanggaran unique (23505, dua admin membuat
// bersamaan) dikembalikan apa adanya di `error.code` agar pemanggil menjawab 409.
export async function buatHeaderDraft(admin, { clientId, tahun, createdBy }) {
  const { data, error } = await admin
    .from(TABEL_DOKUMEN_BPA1)
    .insert([
      {
        client_id: clientId,
        tahun_pajak: tahun,
        versi: VERSI_DOKUMEN_AWAL,
        status: STATUS_DOKUMEN_AWAL,
        created_by: createdBy,
      },
    ])
    .select()
    .single();
  if (error) return { data: null, error };
  return { data, error: null };
}
