import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployee } from '@/lib/notify';
import { SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN } from '@/lib/leave';
import { formatRupiah } from '@/lib/format';
import { friendlyError } from '@/lib/errorMessage';
import {
  REIMBURSEMENT_ACTION_TARGET,
  canTransitionReimbursement,
  normalizeReimbursementText,
  pesanTransisiTidakValid,
} from '@/lib/reimbursement';

// PATCH /api/reimbursement/[id]/status   body: { action, reason?, note? }
//   'approve' : pending  -> approved
//   'reject'  : pending  -> rejected   (reason = alasan penolakan, opsional)
//   'pay'     : approved -> paid       (note = catatan pembayaran, opsional)
//
// Hanya akun aktif dengan modul reimbursement_admin (superadmin lolos
// otomatis lewat isModuleGranted). Dulu keputusan dikirim langsung dari
// browser tanpa syarat status, sehingga klaim yang sudah paid/rejected bisa
// diubah lagi, dua admin saling menimpa, dan approved_by berasal dari client.
// Di sini transisi divalidasi, update bersyarat pada status yang dibaca, dan
// approved_by/updated_at diisi server dari sesi.
//
// Memproses klaim milik sendiri ditolak (flag bersama
// SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN di lib/leave.js, sama seperti cuti
// dan lembur).
//
// Catatan: penegakan penuh juga butuh RLS yang melarang UPDATE langsung dari
// browser ke reimbursement_requests — lihat ringkasan patch.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['reimbursement_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : '';
    const target = REIMBURSEMENT_ACTION_TARGET[action];
    if (!target) {
      return NextResponse.json({ error: 'Aksi tidak valid.' }, { status: 400 });
    }

    const { data: row, error: rowError } = await admin
      .from('reimbursement_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (rowError) {
      // 22P02 = id bukan format yang valid untuk kolom id
      if (rowError.code === '22P02') {
        return NextResponse.json({ error: 'Klaim tidak ditemukan.' }, { status: 404 });
      }
      return NextResponse.json(
        { error: `Gagal memuat klaim: ${friendlyError(rowError, 'terjadi kesalahan pada server.', { context: 'Muat klaim reimbursement' })}` },
        { status: 500 }
      );
    }
    if (!row) {
      return NextResponse.json({ error: 'Klaim tidak ditemukan.' }, { status: 404 });
    }

    if (row.employee_id === emp.id && !(SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN && emp.is_superadmin)) {
      return NextResponse.json({ error: 'Tidak boleh memproses klaim milik sendiri.' }, { status: 403 });
    }

    if (!canTransitionReimbursement(row.status, target)) {
      return NextResponse.json(
        { error: pesanTransisiTidakValid(action), status: row.status },
        { status: 409 }
      );
    }

    const sekarang = new Date().toISOString();
    let patch;
    if (action === 'pay') {
      patch = { status: 'paid', paid_note: normalizeReimbursementText(body.note), updated_at: sekarang };
    } else {
      patch = {
        status: target,
        approved_by: emp.id,
        // Alasan hanya relevan untuk penolakan; menyetujui mengosongkannya.
        rejection_reason: action === 'reject' ? normalizeReimbursementText(body.reason) : null,
        updated_at: sekarang,
      };
    }

    // Update bersyarat: hanya kalau status di DB masih sama dengan yang
    // dibaca, sehingga dua admin yang bertindak bersamaan tidak saling menimpa.
    const { data: updated, error: updateError } = await admin
      .from('reimbursement_requests')
      .update(patch)
      .eq('id', id)
      .eq('status', row.status)
      .select()
      .maybeSingle();
    if (updateError) {
      return NextResponse.json(
        { error: `Gagal memperbarui status klaim: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Perbarui status reimbursement' })}` },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'Status klaim baru saja berubah. Muat ulang halaman lalu coba lagi.' },
        { status: 409 }
      );
    }

    if (action === 'pay') {
      await logActivity(admin, {
        userId: emp.id,
        aksi: 'tandai_dibayar_reimbursement',
        targetTable: 'reimbursement_requests',
        targetId: row.id,
        detail: { employee_id: row.employee_id, jumlah: row.jumlah },
      });
    } else {
      const label = action === 'approve' ? 'disetujui' : 'ditolak';
      await notifyEmployee(admin, {
        userId: row.employee_id,
        tipe: `reimbursement_${target}`,
        pesan: `Klaim reimbursement kamu (${formatRupiah(row.jumlah)}, ${row.kategori}) telah ${label}.`,
        link: '/employee/reimbursement',
      });
      await logActivity(admin, {
        userId: emp.id,
        aksi: `${action}_reimbursement`,
        targetTable: 'reimbursement_requests',
        targetId: row.id,
        detail: { employee_id: row.employee_id, jumlah: row.jumlah, kategori: row.kategori },
      });
    }

    return NextResponse.json({ success: true, request: updated });
  } catch (err) {
    console.error('Proses reimbursement error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
