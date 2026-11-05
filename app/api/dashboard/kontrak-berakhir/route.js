import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { todayJakarta } from '@/lib/serverTime';
import { KONTRAK_PERINGATAN_HARI, tambahHari, statusKontrak, JENIS_DENGAN_AKHIR_KONTRAK } from '@/lib/kepegawaian';
import { kontrakEfektif, ringkasanDurasi } from '@/lib/kontrakRiwayat';
import { friendlyError } from '@/lib/errorMessage';

// GET /api/dashboard/kontrak-berakhir
//
// Widget "Kontrak berakhir" di dashboard HRIS: karyawan PKWT/Magang yang
// kontraknya berakhir dalam KONTRAK_PERINGATAN_HARI hari ke depan, ditambah
// yang tanggalnya sudah lewat tetapi masih aktif (kontrak belum diperpanjang
// atau tanggalnya belum diperbarui HR).
//
// Hak akses: modul employee_list atau payroll (superadmin lolos). Query
// memakai service role karena RLS employees_master tidak berlaku di sini,
// jadi hak modul dicek manual lewat requireModuleAccess.
// Respons: { today, thresholdDays, total, berakhir, segera, items: [...] }
// `items` dibatasi MAX_ITEMS, urut dari tanggal berakhir paling awal.
// Tiap item juga membawa `bisa_perpanjang` (pemanggil punya modul payroll dan
// jenisnya PKWT/Magang) dan `batas_durasi` (peringatan batas durasi kumulatif dari
// riwayat kontrak; null bila aman/tidak berlaku). Bila tabel riwayat belum ada
// (migrasi belum dijalankan), `batas_durasi` kosong dan widget tetap jalan seperti biasa.
const MAX_ITEMS = 20;

export async function GET() {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['employee_list', 'payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const today = todayJakarta();
    const batas = tambahHari(today, KONTRAK_PERINGATAN_HARI);

    const { data, error } = await admin
      .from('employees_master')
      .select(
        'id, nama, posisi, jenis_hubungan_kerja, tanggal_bergabung, kontrak_berakhir, linked_employee_id, employees:linked_employee_id ( id, status ), companies:client_id ( nama_perusahaan )'
      )
      .not('kontrak_berakhir', 'is', null)
      .lte('kontrak_berakhir', batas)
      .order('kontrak_berakhir', { ascending: true });
    if (error) {
      return NextResponse.json(
        { error: `Gagal memuat kontrak berakhir: ${friendlyError(error, 'terjadi kesalahan pada server.', { context: 'Muat kontrak berakhir' })}` },
        { status: 500 }
      );
    }

    // Akun yang sudah dinonaktifkan tidak perlu diingatkan. Baris payroll-only
    // (tanpa akun) tetap ikut.
    const rows = (data || []).filter((r) => !r.employees || r.employees.status === 'Aktif');

    // Riwayat kontrak hanya untuk item yang tampil. Gagal baca riwayat tidak
    // boleh merusak widget: peringatan batas dilewati saja.
    const tampil = rows.slice(0, MAX_ITEMS);
    const idTampil = new Set(tampil.map((r) => r.id));
    const kontrakPerMaster = new Map();
    let riwayatTersedia = false;
    if (tampil.length > 0) {
      const { data: riwayat, error: riwayatError } = await admin
        .from('employee_contracts')
        .select('master_id, jenis, tanggal_mulai, tanggal_berakhir')
        .in('master_id', tampil.map((r) => r.id));
      if (riwayatError) {
        console.error('Muat riwayat kontrak untuk widget gagal:', riwayatError);
      } else {
        riwayatTersedia = true;
        for (const c of riwayat || []) {
          if (!kontrakPerMaster.has(c.master_id)) kontrakPerMaster.set(c.master_id, []);
          kontrakPerMaster.get(c.master_id).push(c);
        }
      }
    }
    const payrollAccess = await requireModuleAccess(admin, ['payroll']);
    const bisaPerpanjang = !payrollAccess.error;

    const items = rows.map((r) => {
      const status = statusKontrak(r.kontrak_berakhir, today);
      let href;
      if (r.linked_employee_id) href = `/employee/list/${r.linked_employee_id}`;
      else href = emp.is_superadmin ? `/employee/payroll/${r.id}` : '/employee/payroll';
      let batasDurasi = null;
      if (riwayatTersedia && idTampil.has(r.id)) {
        const ringkasan = ringkasanDurasi(kontrakEfektif(kontrakPerMaster.get(r.id) || [], r), r.jenis_hubungan_kerja);
        if (ringkasan.status === 'mendekati' || ringkasan.status === 'melewati') {
          batasDurasi = { status: ringkasan.status, label: ringkasan.label };
        }
      }
      return {
        id: r.id,
        nama: r.nama,
        posisi: r.posisi || null,
        perusahaan: r.companies?.nama_perusahaan || null,
        jenis: r.jenis_hubungan_kerja || null,
        kontrak_berakhir: r.kontrak_berakhir,
        sisa_hari: status.sisaHari,
        kind: status.kind,
        bisa_perpanjang: bisaPerpanjang && JENIS_DENGAN_AKHIR_KONTRAK.includes(r.jenis_hubungan_kerja),
        batas_durasi: batasDurasi,
        href,
      };
    });

    return NextResponse.json({
      today,
      thresholdDays: KONTRAK_PERINGATAN_HARI,
      total: items.length,
      berakhir: items.filter((i) => i.kind === 'berakhir').length,
      segera: items.filter((i) => i.kind === 'segera').length,
      items: items.slice(0, MAX_ITEMS),
    });
  } catch (err) {
    console.error('Muat kontrak berakhir error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
