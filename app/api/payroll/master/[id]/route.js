import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { STATUS_OPTIONS } from '@/lib/payrollConfig';
import { validateKepegawaian } from '@/lib/kepegawaian';

// PATCH /api/payroll/master/[id]
//   body: { posisi?, status?, gaji_pokok?, tunjangan?,
//           tanggal_bergabung?, jenis_hubungan_kerja?, kontrak_berakhir? }
//
// Edit data HR/payroll ringkas dari halaman detail employee (employees_master).
// Dulu browser meng-update employees_master langsung tanpa activity log sama
// sekali, padahal gaji_pokok/tunjangan menjadi dasar slip. Di sini hak modul
// payroll dicek, hanya kolom di whitelist yang diterima, dan perubahan
// (sebelum -> sesudah) dicatat server-side sebagai edit_struktur_gaji.
//
// Cakupan sengaja sempit: form lengkap di Payroll Manager
// (app/employee/payroll/page.js) belum lewat rute ini.
const KEPEGAWAIAN_KEYS = ['tanggal_bergabung', 'jenis_hubungan_kerja', 'kontrak_berakhir'];
const EDITABLE = ['posisi', 'status', 'gaji_pokok', 'tunjangan', ...KEPEGAWAIAN_KEYS];
const MAX_POSISI_LENGTH = 200;
const MAX_NOMINAL = 1_000_000_000_000;

function validNominal(value) {
  if (value === '' || value === null || typeof value === 'boolean') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > MAX_NOMINAL) return null;
  return num;
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => ({}));
    const patch = {};

    if (body.posisi !== undefined) {
      if (typeof body.posisi !== 'string') {
        return NextResponse.json({ error: 'Posisi tidak valid.' }, { status: 400 });
      }
      patch.posisi = body.posisi.trim().slice(0, MAX_POSISI_LENGTH);
    }
    if (body.status !== undefined) {
      if (!STATUS_OPTIONS.includes(body.status)) {
        return NextResponse.json({ error: 'Status karyawan tidak valid.' }, { status: 400 });
      }
      patch.status = body.status;
    }
    for (const key of ['gaji_pokok', 'tunjangan']) {
      if (body[key] === undefined) continue;
      const nominal = validNominal(body[key]);
      if (nominal === null) {
        return NextResponse.json(
          { error: `${key === 'gaji_pokok' ? 'Gaji pokok' : 'Tunjangan'} harus berupa angka 0 atau lebih.` },
          { status: 400 }
        );
      }
      patch[key] = nominal;
    }
    // Data kepegawaian: string 'YYYY-MM-DD' / jenis, atau ''/null untuk
    // mengosongkan. Aturan antar-field divalidasi setelah baris lama dimuat
    // (di bawah), karena PATCH boleh hanya mengirim sebagian field.
    for (const key of KEPEGAWAIAN_KEYS) {
      if (body[key] === undefined) continue;
      if (body[key] !== null && typeof body[key] !== 'string') {
        return NextResponse.json({ error: 'Data kepegawaian tidak valid.' }, { status: 400 });
      }
      patch[key] = body[key] ? body[key].trim() : null;
    }
    // Ganti ke PKWTT tanpa menyebut tanggal berakhir = kosongkan tanggal itu
    // (PKWTT tidak punya tanggal berakhir), sama seperti form di Payroll Manager.
    if (patch.jenis_hubungan_kerja === 'PKWTT' && body.kontrak_berakhir === undefined) {
      patch.kontrak_berakhir = null;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Tidak ada perubahan yang dikirim.' }, { status: 400 });
    }

    const { data: before, error: beforeError } = await admin
      .from('employees_master')
      .select(EDITABLE.join(', ') + ', nama')
      .eq('id', id)
      .maybeSingle();
    if (beforeError) {
      if (beforeError.code === '22P02') {
        return NextResponse.json({ error: 'Data employee tidak ditemukan.' }, { status: 404 });
      }
      return NextResponse.json(
        { error: `Gagal memuat data employee: ${friendlyError(beforeError, 'terjadi kesalahan pada server.', { context: 'Muat employees_master' })}` },
        { status: 500 }
      );
    }
    if (!before) {
      return NextResponse.json({ error: 'Data employee tidak ditemukan.' }, { status: 404 });
    }

    if (KEPEGAWAIAN_KEYS.some((key) => key in patch)) {
      const kepegawaianError = validateKepegawaian({
        tanggal_bergabung: 'tanggal_bergabung' in patch ? patch.tanggal_bergabung : before.tanggal_bergabung,
        jenis_hubungan_kerja: 'jenis_hubungan_kerja' in patch ? patch.jenis_hubungan_kerja : before.jenis_hubungan_kerja,
        kontrak_berakhir: 'kontrak_berakhir' in patch ? patch.kontrak_berakhir : before.kontrak_berakhir,
      });
      if (kepegawaianError) {
        return NextResponse.json({ error: kepegawaianError }, { status: 400 });
      }
    }

    const { data: updated, error: updateError } = await admin
      .from('employees_master')
      .update(patch)
      .eq('id', id)
      .select(EDITABLE.join(', '))
      .maybeSingle();
    if (updateError) {
      return NextResponse.json(
        { error: `Gagal menyimpan data HR/payroll: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Ubah employees_master' })}` },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json({ error: 'Data employee tidak ditemukan.' }, { status: 404 });
    }

    const sebelum = {};
    const sesudah = {};
    for (const key of Object.keys(patch)) {
      if (before[key] !== updated[key]) {
        sebelum[key] = before[key];
        sesudah[key] = updated[key];
      }
    }
    if (Object.keys(sesudah).length > 0) {
      await logActivity(admin, {
        userId: emp.id,
        aksi: 'edit_struktur_gaji',
        targetTable: 'employees_master',
        targetId: id,
        detail: { nama: before.nama, sebelum, sesudah },
      });
    }

    return NextResponse.json({ success: true, master: updated });
  } catch (err) {
    console.error('Ubah employees_master error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
