import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployee } from '@/lib/notify';
import { SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN } from '@/lib/leave';
import { formatTanggal } from '@/lib/leaveServer';
import { jenisHariValid, MAKS_ALASAN_LEMBUR } from '@/lib/overtimeRules';

// POST /api/overtime-requests/[id]/decision
//   body: { decision: 'approved' | 'rejected', jam_disetujui?, jenis_hari?, rejection_reason? }
//   approved : pending -> approved. jam_disetujui (opsional, > 0 dan <= durasi
//              pengajuan; default = durasi pengajuan) dan jenis_hari (opsional,
//              untuk menimpa jenis hari, mis. hari libur nasional).
//   rejected : pending -> rejected. rejection_reason WAJIB.
//
// Hanya akun aktif dengan modul overtime_admin (superadmin lolos otomatis lewat
// isModuleGranted). Memproses pengajuan milik sendiri ditolak (lihat
// SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN di lib/leave.js). Update status
// compare-and-swap supaya dua admin yang menekan bersamaan tidak saling menimpa.
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['overtime_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => ({}));
    const decision = body?.decision;
    if (!['approved', 'rejected'].includes(decision)) {
      return NextResponse.json({ error: 'Keputusan tidak valid.' }, { status: 400 });
    }

    const { data: row, error: rowError } = await admin
      .from('overtime_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (rowError) {
      console.error('Muat pengajuan lembur error:', rowError);
      return NextResponse.json({ error: 'Gagal memuat pengajuan lembur.' }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: 'Pengajuan lembur tidak ditemukan.' }, { status: 404 });
    }

    if (row.employee_id === emp.id && !(SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN && emp.is_superadmin)) {
      return NextResponse.json({ error: 'Tidak boleh memproses pengajuan lembur milik sendiri.' }, { status: 403 });
    }

    if (row.status !== 'pending') {
      return NextResponse.json(
        {
          error: 'Pengajuan ini sudah tidak berstatus menunggu (mungkin dibatalkan karyawan atau sudah diproses). Daftar dimuat ulang.',
          status: row.status,
        },
        { status: 409 }
      );
    }

    const sekarang = new Date().toISOString();
    let patch;
    let jamDisetujui = null;
    let jenisHari = row.jenis_hari;

    if (decision === 'rejected') {
      const alasanTolak = typeof body?.rejection_reason === 'string' ? body.rejection_reason.trim() : '';
      if (!alasanTolak) {
        return NextResponse.json({ error: 'Alasan penolakan wajib diisi.' }, { status: 400 });
      }
      if (alasanTolak.length > MAKS_ALASAN_LEMBUR) {
        return NextResponse.json({ error: `Alasan penolakan maksimal ${MAKS_ALASAN_LEMBUR} karakter.` }, { status: 400 });
      }
      patch = { status: 'rejected', approved_by: emp.id, rejection_reason: alasanTolak };
    } else {
      const maksJam = row.durasi_menit / 60;
      if (body?.jam_disetujui === undefined || body?.jam_disetujui === null || body?.jam_disetujui === '') {
        jamDisetujui = Math.round(maksJam * 100) / 100;
      } else {
        const angka = Number(body.jam_disetujui);
        if (!Number.isFinite(angka) || angka <= 0) {
          return NextResponse.json({ error: 'Jam disetujui harus lebih dari 0.' }, { status: 400 });
        }
        jamDisetujui = Math.round(angka * 100) / 100;
        if (jamDisetujui > Math.round(maksJam * 100) / 100) {
          return NextResponse.json(
            { error: `Jam disetujui tidak boleh melebihi durasi pengajuan (${Number(maksJam.toFixed(2))} jam).` },
            { status: 400 }
          );
        }
      }

      if (body?.jenis_hari !== undefined && body?.jenis_hari !== null && body?.jenis_hari !== '') {
        if (!jenisHariValid(body.jenis_hari)) {
          return NextResponse.json({ error: 'Jenis hari tidak valid.' }, { status: 400 });
        }
        jenisHari = body.jenis_hari;
      }
      patch = { status: 'approved', approved_by: emp.id, jam_disetujui: jamDisetujui, jenis_hari: jenisHari, rejection_reason: null };
    }

    const { data: updated, error: updateError } = await admin
      .from('overtime_requests')
      .update({ ...patch, updated_at: sekarang })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    if (updateError) {
      console.error('Proses lembur error:', updateError);
      return NextResponse.json({ error: 'Gagal memperbarui status pengajuan lembur. Coba lagi.' }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'Pengajuan ini baru saja diproses pihak lain. Daftar dimuat ulang.' },
        { status: 409 }
      );
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: decision === 'approved' ? 'approve_lembur' : 'reject_lembur',
      targetTable: 'overtime_requests',
      targetId: row.id,
      detail: {
        employee_id: row.employee_id,
        tanggal: row.tanggal,
        durasi_menit: row.durasi_menit,
        jam_disetujui: jamDisetujui,
        jenis_hari_sebelum: row.jenis_hari,
        jenis_hari_sesudah: decision === 'approved' ? jenisHari : row.jenis_hari,
        rejection_reason: decision === 'rejected' ? patch.rejection_reason : null,
      },
    });

    const ringkas = decision === 'approved'
      ? `disetujui (${String(jamDisetujui).replace('.', ',')} jam)`
      : `ditolak. Alasan: ${patch.rejection_reason}`;
    await notifyEmployee(admin, {
      userId: row.employee_id,
      tipe: `lembur_${decision}`,
      pesan: `Pengajuan lembur kamu (${formatTanggal(row.tanggal)}) telah ${ringkas}.`,
      link: '/employee/overtime',
    });

    return NextResponse.json({ success: true, request: updated });
  } catch (err) {
    console.error('Proses lembur error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
