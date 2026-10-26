import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { validasiKebijakan, normalisasiKebijakan } from '@/lib/leavePolicy';
import { ambilKebijakanCuti } from '@/lib/leaveServer';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';

// PUT /api/leave-policy
// Ubah kebijakan kuota cuti perusahaan (tabel leave_policies, satu baris).
// Hanya pemegang modul Payroll / superadmin — sama seperti pengaturan jatah
// per karyawan. Mengubah kebijakan memengaruhi perhitungan sisa cuti semua
// karyawan, jadi dibuat compare-and-swap: body wajib membawa `versi`
// (updated_at yang terakhir dilihat); kalau kebijakan sudah diubah orang lain,
// jawab 409 dan layar harus dimuat ulang. Perubahan dicatat di activity log.
export async function PUT(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payroll']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await request.json().catch(() => ({}));
    const hasil = validasiKebijakan(body);
    if (!hasil.ok) {
      return NextResponse.json({ error: hasil.error }, { status: 400 });
    }

    const sebelum = await ambilKebijakanCuti(admin);
    if (sebelum.error) {
      console.error('Ubah kebijakan cuti — baca kebijakan error:', sebelum.error);
      return NextResponse.json({ error: friendlyError(sebelum.error, 'Gagal memuat kebijakan cuti.', { context: 'Muat kebijakan cuti' }) }, { status: 500 });
    }

    const patch = { ...hasil.value, updated_at: new Date().toISOString(), updated_by: access.emp.id };

    let saved;
    if (sebelum.versi === null) {
      // Baris belum ada (migrasi belum menyemai) — buat.
      const ins = await admin.from('leave_policies').insert([{ id: 1, ...patch }]).select().maybeSingle();
      if (ins.error) {
        console.error('Ubah kebijakan cuti — insert error:', ins.error);
        return NextResponse.json({ error: friendlyError(ins.error, 'Gagal menyimpan kebijakan cuti.', { context: 'Simpan kebijakan cuti' }) }, { status: 500 });
      }
      saved = ins.data;
    } else {
      if (typeof body?.versi !== 'string' || body.versi !== sebelum.versi) {
        return NextResponse.json(
          { error: 'Kebijakan sudah diubah oleh orang lain. Halaman dimuat ulang — periksa lalu simpan lagi.' },
          { status: 409 }
        );
      }
      const upd = await admin
        .from('leave_policies')
        .update(patch)
        .eq('id', 1)
        .eq('updated_at', sebelum.versi)
        .select()
        .maybeSingle();
      if (upd.error) {
        console.error('Ubah kebijakan cuti — update error:', upd.error);
        return NextResponse.json({ error: friendlyError(upd.error, 'Gagal menyimpan kebijakan cuti.', { context: 'Simpan kebijakan cuti' }) }, { status: 500 });
      }
      if (!upd.data) {
        return NextResponse.json(
          { error: 'Kebijakan baru saja diubah oleh orang lain. Halaman dimuat ulang — periksa lalu simpan lagi.' },
          { status: 409 }
        );
      }
      saved = upd.data;
    }

    await logActivity(admin, {
      userId: access.emp.id,
      aksi: 'ubah_kebijakan_cuti',
      targetTable: 'leave_policies',
      targetId: null,
      detail: { sebelum: sebelum.kebijakan, sesudah: hasil.value },
    });

    return NextResponse.json({ kebijakan: normalisasiKebijakan(saved), versi: saved.updated_at });
  } catch (err) {
    console.error('Ubah kebijakan cuti error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
