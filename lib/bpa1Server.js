import { idBentukValid } from '@/lib/payrollRunServer';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { bacaTahun, TAHUN_MIN, TAHUN_MAX } from '@/lib/bpa1Source';

// SERVER ONLY — logika pembuatan dokumen BPA1 (Bukti Potong A1 tahunan per
// klien) untuk POST /api/bpa1 (BPA-06).
//
// OTORISASI BUKAN TUGAS FILE INI. `admin` WAJIB client service role
// (createAdminClient()) sehingga RLS tidak berlaku; pemanggil harus lebih dulu
// lolos requireBpa1Access(admin) dari lib/moduleAccessServer.js.
//
// Cakupan: BPA-06 (header dokumen Draft v1) dan BPA-09 (snapshot bulanan dari
// Payroll Run ke tabel BPA1, dengan rollback). Tidak ada kalkulasi pajak
// (BPA-14/15) dan tidak ada pemetaan/tafsir komponen pajak (BPA-10): nilai
// disalin MENTAH apa adanya dari item Payroll Run.
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
//
// ASUMSI SNAPSHOT (BPA-09) — PALING RAPUH, tidak ada petunjuk nama/kolomnya di
// repo maupun brief; semuanya USULAN dan terkumpul di blok SKEMA_SNAPSHOT_BPA1
// di bawah supaya mudah dicocokkan dengan DDL nyata:
//  - bpa1_items: id, document_id, employee_master_id (satu baris per karyawan
//    per dokumen; GET /api/bpa1 hanya memakai id dan document_id).
//  - tabel snapshot bulanan bernama `bpa1_item_bulan` (NAMA INI TEBAKAN):
//    id, item_id (-> bpa1_items.id), periode ('YYYY-MM'), run_id, status_run,
//    lalu nilai mentah: gaji_pokok, allowance, overtime, insentif, kompensasi,
//    penalty, bpjs_employer, bpjs_employee, pph21, take_home_pay, incomplete.
//  - kunci unik (item_id, periode) dan ON DELETE CASCADE TIDAK diasumsikan:
//    rollback menghapus anak-anaknya secara eksplisit.

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

// ---------------------------------------------------------------------------
// BPA-09 — snapshot bulanan
// ---------------------------------------------------------------------------

// USULAN, belum divalidasi terhadap DB (lihat catatan di kepala file).
export const SKEMA_SNAPSHOT_BPA1 = {
  tabelItem: 'bpa1_items',
  tabelBulan: 'bpa1_item_bulan',
  kolomKaryawan: 'employee_master_id',
};

// Nilai MENTAH item Payroll Run yang disalin per bulan. Tidak ditafsirkan,
// tidak dihitung ulang, tidak dibulatkan; pemetaan ke komponen pajak = BPA-10.
export const KOLOM_NILAI_SNAPSHOT = [
  'gaji_pokok',
  'allowance',
  'overtime',
  'insentif',
  'kompensasi',
  'penalty',
  'bpjs_employer',
  'bpjs_employee',
  'pph21',
  'take_home_pay',
  'incomplete',
];

export const BPA1_DATA_SUMBER_TIDAK_VALID = 'BPA1_DATA_SUMBER_TIDAK_VALID';
export const BPA1_TIDAK_ADA_DATA_SUMBER = 'BPA1_TIDAK_ADA_DATA_SUMBER';
export const BPA1_SNAPSHOT_GAGAL = 'BPA1_SNAPSHOT_GAGAL';

// Insert dipecah per 500 baris; delete/in() per 100 id (URL query tidak boleh
// kepanjangan; pola yang sama dengan GET /api/bpa1).
const UKURAN_INSERT = 500;
const UKURAN_CHUNK_ID = 100;

function pecah(daftar, ukuran) {
  const hasil = [];
  for (let i = 0; i < daftar.length; i += ukuran) hasil.push(daftar.slice(i, i + ukuran));
  return hasil;
}

function tabelBelumAda(error) {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205');
}

// MURNI (tanpa DB). Menyusun rencana tulis dari hasil loadBpa1Sumber (BPA-08).
//
// Kebijakan K-17 (USULAN, belum dikonfirmasi): SEMUA run yang ada disalin apa
// pun statusnya; status run disimpan per baris bulanan (`status_run`) supaya
// finalisasi (BPA-22) bisa menahan bila ada yang belum Approved. Tidak ada
// filter status di sini. Bulan tanpa run TIDAK diisi nol: tidak ada baris sama
// sekali untuk bulan itu (ditandai ada_run:false di ringkasan `bulan`).
//
// Return { data, error }:
//  data  = { karyawan: [employee_master_id...], baris: [...], bulan: [...] }
//          baris = { employee_master_id, periode, run_id, status_run, ...nilai }
//          bulan = [{ periode, ada_run, status_run, jumlah_baris }] (12 entri)
//  error = { code, message } bila sumber tidak bisa dipakai apa adanya —
//          lebih baik berhenti daripada menebak.
export function susunSnapshotBpa1(sumber) {
  const salah = (code, message) => ({ data: null, error: { code, message } });
  const karyawan = [];
  const dikenal = new Set();
  const baris = [];
  const bulan = [];

  for (const b of sumber?.bulan || []) {
    if (!b.adaRun) {
      bulan.push({ periode: b.periode, ada_run: false, status_run: null, jumlah_baris: 0 });
      continue;
    }
    const dalamBulan = new Set();
    for (const item of b.items || []) {
      const empId = item.employee_master_id;
      if (empId === null || empId === undefined || empId === '') {
        return salah(
          BPA1_DATA_SUMBER_TIDAK_VALID,
          `Ada item Payroll Run periode ${b.periode} tanpa karyawan; snapshot dibatalkan.`
        );
      }
      if (dalamBulan.has(empId)) {
        return salah(
          BPA1_DATA_SUMBER_TIDAK_VALID,
          `Ada karyawan yang muncul lebih dari satu kali pada Payroll Run periode ${b.periode}; snapshot dibatalkan.`
        );
      }
      dalamBulan.add(empId);
      if (!dikenal.has(empId)) {
        dikenal.add(empId);
        karyawan.push(empId);
      }
      const row = { employee_master_id: empId, periode: b.periode, run_id: b.run.id, status_run: b.run.status };
      for (const kolom of KOLOM_NILAI_SNAPSHOT) row[kolom] = item[kolom] ?? null;
      baris.push(row);
    }
    bulan.push({ periode: b.periode, ada_run: true, status_run: b.run.status, jumlah_baris: dalamBulan.size });
  }

  if (karyawan.length === 0) {
    return salah(
      BPA1_TIDAK_ADA_DATA_SUMBER,
      'Tidak ada item Payroll Run pada tahun ini untuk klien tersebut, jadi tidak ada yang bisa disalin ke BPA1.'
    );
  }
  return { data: { karyawan, baris, bulan }, error: null };
}

// Pemeriksaan awal TANPA menulis: kedua tabel snapshot terbaca. Dipanggil
// sebelum header dibuat supaya tabel yang belum ada (atau nama tabel usulan
// yang salah) ketahuan sebelum ada data yang tertulis. Tidak memeriksa kolom.
// Return { error } (error null bila lolos).
export async function periksaTabelSnapshot(admin) {
  for (const tabel of [SKEMA_SNAPSHOT_BPA1.tabelItem, SKEMA_SNAPSHOT_BPA1.tabelBulan]) {
    const { error } = await admin.from(tabel).select('id').limit(1);
    if (error) return { error };
  }
  return { error: null };
}

// Tulis item karyawan lalu baris bulanan untuk dokumen yang SUDAH dibuat.
// Tidak atomik sendiri (Supabase JS tidak punya transaksi multi-statement):
// pemanggil WAJIB memanggil hapusDokumenBpa1 bila ini mengembalikan error.
// Return { data: { jumlahItem, jumlahBaris }, error } — pada error, `tahap`
// ('item' | 'bulan') menunjukkan langkah yang gagal.
export async function simpanSnapshotBpa1(admin, documentId, snapshot) {
  const { tabelItem, tabelBulan, kolomKaryawan } = SKEMA_SNAPSHOT_BPA1;
  const gagal = (tahap, error) => ({ data: null, error: { ...error, tahap } });

  const itemIdPerKaryawan = new Map();
  for (const bagian of pecah(snapshot.karyawan, UKURAN_INSERT)) {
    const { data, error } = await admin
      .from(tabelItem)
      .insert(bagian.map((empId) => ({ document_id: documentId, [kolomKaryawan]: empId })))
      .select(`id, ${kolomKaryawan}`);
    if (error) return gagal('item', error);
    for (const row of data || []) itemIdPerKaryawan.set(row[kolomKaryawan], row.id);
  }
  if (itemIdPerKaryawan.size !== snapshot.karyawan.length) {
    return gagal('item', {
      code: 'BPA1_ITEM_TIDAK_LENGKAP',
      message: 'Jumlah item karyawan yang tersimpan tidak sama dengan yang diminta.',
    });
  }

  const barisBulan = snapshot.baris.map(({ employee_master_id: empId, ...nilai }) => ({
    item_id: itemIdPerKaryawan.get(empId),
    ...nilai,
  }));
  for (const bagian of pecah(barisBulan, UKURAN_INSERT)) {
    const { error } = await admin.from(tabelBulan).insert(bagian);
    if (error) return gagal('bulan', error);
  }

  return { data: { jumlahItem: snapshot.karyawan.length, jumlahBaris: barisBulan.length }, error: null };
}

// Rollback: hapus dokumen beserta item dan baris bulanannya, anak lebih dulu
// (tidak mengandalkan ON DELETE CASCADE yang belum terverifikasi). Berhenti di
// error pertama. Tabel bulanan yang belum ada dianggap tidak ada yang dihapus.
// Return { error } (error null bila bersih).
export async function hapusDokumenBpa1(admin, documentId) {
  const { tabelItem, tabelBulan } = SKEMA_SNAPSHOT_BPA1;

  const itemsRes = await fetchAllRows(() => admin.from(tabelItem).select('id').eq('document_id', documentId));
  if (itemsRes.error) return { error: itemsRes.error };

  for (const bagian of pecah(itemsRes.data.map((r) => r.id), UKURAN_CHUNK_ID)) {
    const { error } = await admin.from(tabelBulan).delete().in('item_id', bagian);
    if (error && !tabelBelumAda(error)) return { error };
  }

  const { error: itemError } = await admin.from(tabelItem).delete().eq('document_id', documentId);
  if (itemError) return { error: itemError };

  const { error: headerError } = await admin.from(TABEL_DOKUMEN_BPA1).delete().eq('id', documentId);
  return { error: headerError || null };
}
