import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { todayJakarta } from '@/lib/serverTime';
import { JENIS_DENGAN_AKHIR_KONTRAK } from '@/lib/kepegawaian';
import { kontrakEfektif, ringkasanDurasi, validatePerpanjangan } from '@/lib/kontrakRiwayat';

// Riwayat kontrak PKWT/Magang satu karyawan (tabel employee_contracts), dikunci
// pada id employees_master.
//
// GET  /api/payroll/master/[id]/contracts
//   Hak akses: modul employee_list atau payroll (superadmin lolos), sama dengan
//   widget Kontrak Berakhir. Respons: { master, contracts, canExtend, today }.
//   `contracts` urut tanggal mulai; `canExtend` = pemanggil boleh perpanjang.
//
// POST /api/payroll/master/[id]/contracts   (perpanjang kontrak)
//   body: { tanggal_mulai, tanggal_berakhir, nomor_kontrak?, catatan?,
//           konfirmasi_melebihi_batas? }
//   Hak akses: modul payroll (setara PATCH /api/payroll/master/[id] yang sudah
//   bisa mengubah kontrak_berakhir). Penulisan dilakukan fungsi Postgres
//   perpanjang_kontrak (atomik: riwayat + employees_master.kontrak_berakhir).
//   Bila total masa kumulatif melebihi batas (lib/kontrakRiwayat.js), server
//   menjawab 409 { code: 'MELEWATI_BATAS' } sampai klien mengirim
//   konfirmasi_melebihi_batas: true. Peringatan, bukan pemblokiran permanen.

const MASTER_COLUMNS = 'id, nama, jenis_hubungan_kerja, tanggal_bergabung, kontrak_berakhir';
const CONTRACT_COLUMNS = 'id, jenis, tanggal_mulai, tanggal_berakhir, nomor_kontrak, catatan, sumber, created_at';

// Pesan error fungsi perpanjang_kontrak (kode di `message`) -> respons klien.
const RPC_ERRORS = {
  MASTER_TIDAK_ADA: { status: 404, error: 'Data employee tidak ditemukan.' },
  BUKAN_PKWT_MAGANG: { status: 409, error: 'Perpanjangan hanya untuk karyawan dengan jenis hubungan kerja PKWT atau Magang.' },
  TANGGAL_TIDAK_VALID: { status: 400, error: 'Tanggal kontrak baru tidak valid.' },
  TUMPANG_TINDIH: { status: 409, error: 'Kontrak baru harus dimulai setelah kontrak terakhir berakhir. Muat ulang halaman, mungkin kontraknya baru saja diperpanjang.' },
};

function tabelBelumAda(error) {
  return error && (error.code === '42P01' || error.code === 'PGRST205');
}

function responError(error, context) {
  if (tabelBelumAda(error)) {
    return NextResponse.json(
      { error: 'Tabel riwayat kontrak belum dibuat. Jalankan migrasi supabase/migrations/20261105120000_employee_contracts.sql di Supabase SQL Editor.' },
      { status: 503 }
    );
  }
  return NextResponse.json(
    { error: `${context}: ${friendlyError(error, 'terjadi kesalahan pada server.', { context })}` },
    { status: 500 }
  );
}

async function muatMaster(admin, id) {
  const { data, error } = await admin.from('employees_master').select(MASTER_COLUMNS).eq('id', id).maybeSingle();
  if (error) {
    if (error.code === '22P02') return { notFound: true };
    return { error };
  }
  if (!data) return { notFound: true };
  return { master: data };
}

async function muatKontrak(admin, masterId) {
  return admin
    .from('employee_contracts')
    .select(CONTRACT_COLUMNS)
    .eq('master_id', masterId)
    .order('tanggal_mulai', { ascending: true });
}

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['employee_list', 'payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const loaded = await muatMaster(admin, id);
    if (loaded.error) return responError(loaded.error, 'Gagal memuat data employee');
    if (loaded.notFound) return NextResponse.json({ error: 'Data employee tidak ditemukan.' }, { status: 404 });

    const { data: contracts, error } = await muatKontrak(admin, id);
    if (error) return responError(error, 'Gagal memuat riwayat kontrak');

    const payrollAccess = await requireModuleAccess(admin, ['payroll']);

    return NextResponse.json(
      { master: loaded.master, contracts: contracts || [], canExtend: !payrollAccess.error, today: todayJakarta() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('Muat riwayat kontrak error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => null);

    const loaded = await muatMaster(admin, id);
    if (loaded.error) return responError(loaded.error, 'Gagal memuat data employee');
    if (loaded.notFound) return NextResponse.json({ error: 'Data employee tidak ditemukan.' }, { status: 404 });
    const { master } = loaded;

    if (!JENIS_DENGAN_AKHIR_KONTRAK.includes(master.jenis_hubungan_kerja)) {
      return NextResponse.json({ error: RPC_ERRORS.BUKAN_PKWT_MAGANG.error }, { status: 409 });
    }

    const { data: contracts, error: contractsError } = await muatKontrak(admin, id);
    if (contractsError) return responError(contractsError, 'Gagal memuat riwayat kontrak');

    const ada = kontrakEfektif(contracts || [], master);
    const { values, error: validationError } = validatePerpanjangan(body, {
      kontrakAda: ada,
      kontrakBerakhirMaster: master.kontrak_berakhir,
    });
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const ringkasan = ringkasanDurasi(
      [...ada, { jenis: master.jenis_hubungan_kerja, tanggal_mulai: values.tanggal_mulai, tanggal_berakhir: values.tanggal_berakhir }],
      master.jenis_hubungan_kerja
    );
    const melebihiBatas = ringkasan.status === 'melewati';
    if (melebihiBatas && !values.konfirmasi_melebihi_batas) {
      return NextResponse.json(
        {
          error: `Perpanjangan ini membuat total masa ${master.jenis_hubungan_kerja} melewati batas. ${ringkasan.label}. Konfirmasi dulu bila tetap ingin menyimpan (angka batas perlu divalidasi tim legal).`,
          code: 'MELEWATI_BATAS',
          ringkasan,
        },
        { status: 409 }
      );
    }

    const { data: kontrakBaru, error: rpcError } = await admin.rpc('perpanjang_kontrak', {
      p_master_id: id,
      p_mulai: values.tanggal_mulai,
      p_berakhir: values.tanggal_berakhir,
      p_nomor: values.nomor_kontrak,
      p_catatan: values.catatan,
      p_actor: emp.id,
    });
    if (rpcError) {
      const known = Object.keys(RPC_ERRORS).find((code) => (rpcError.message || '').includes(code));
      if (known) return NextResponse.json({ error: RPC_ERRORS[known].error }, { status: RPC_ERRORS[known].status });
      if (rpcError.code === '42883' || rpcError.code === 'PGRST202') {
        return NextResponse.json(
          { error: 'Fungsi perpanjang_kontrak belum dibuat. Jalankan migrasi supabase/migrations/20261105120000_employee_contracts.sql di Supabase SQL Editor.' },
          { status: 503 }
        );
      }
      return responError(rpcError, 'Gagal memperpanjang kontrak');
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'perpanjang_kontrak',
      targetTable: 'employee_contracts',
      targetId: kontrakBaru?.id || null,
      detail: {
        nama: master.nama,
        jenis: master.jenis_hubungan_kerja,
        kontrak_berakhir: { sebelum: master.kontrak_berakhir, sesudah: values.tanggal_berakhir },
        tanggal_mulai: values.tanggal_mulai,
        nomor_kontrak: values.nomor_kontrak,
        melebihi_batas_dikonfirmasi: melebihiBatas,
      },
    });

    return NextResponse.json({ success: true, contract: kontrakBaru, ringkasan });
  } catch (err) {
    console.error('Perpanjang kontrak error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
