import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployee } from '@/lib/notify';
import { NOTIFICATION_EVENTS, MAKS_PESAN, JENDELA_DUPLIKAT_MS } from '@/lib/notificationEvents';
import { friendlyError } from '@/lib/errorMessage';

// POST /api/payslips/[id]/publish   body: { publish: boolean }
//
// Satu-satunya jalan menerbitkan/menarik slip gaji. Dulu browser meng-update
// payslips.is_published langsung, lalu memicu notifikasi dan activity log dari
// browser (bisa terlewat kalau tab ditutup). Di sini update, log, dan
// notifikasi terjadi server-side. Log dicatat untuk publish MAUPUN tarik
// kembali.
//
// Penegakan penuh juga butuh trigger DB yang melarang browser mengubah
// payslips.is_published langsung — lihat
// supabase/migrations/20261022_payroll_approval_atomik.sql.
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['payslip_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    const body = await request.json().catch(() => ({}));
    if (typeof body?.publish !== 'boolean') {
      return NextResponse.json({ error: 'Nilai publish tidak valid.' }, { status: 400 });
    }
    const publish = body.publish;

    // Update bersyarat pada status sebelumnya, jadi dua admin yang menekan
    // tombol bersamaan tidak menghasilkan log/notifikasi ganda.
    const { data: updated, error: updateError } = await admin
      .from('payslips')
      .update({ is_published: publish })
      .eq('id', id)
      .eq('is_published', !publish)
      .select('id, employee_id, periode')
      .maybeSingle();
    if (updateError) {
      // 22P02 = id bukan format yang valid untuk kolom id
      if (updateError.code === '22P02') {
        return NextResponse.json({ error: 'Slip gaji tidak ditemukan.' }, { status: 404 });
      }
      return NextResponse.json(
        { error: `Gagal memperbarui status slip: ${friendlyError(updateError, 'terjadi kesalahan pada server.', { context: 'Publish slip gaji' })}` },
        { status: 500 }
      );
    }

    if (!updated) {
      const { data: existing } = await admin
        .from('payslips')
        .select('is_published')
        .eq('id', id)
        .maybeSingle();
      if (!existing) {
        return NextResponse.json({ error: 'Slip gaji tidak ditemukan.' }, { status: 404 });
      }
      // Sudah dalam keadaan yang diminta: tidak ada yang berubah, tidak ada log.
      return NextResponse.json({ success: true, is_published: existing.is_published, changed: false });
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: publish ? 'publish_payslip' : 'unpublish_payslip',
      targetTable: 'payslips',
      targetId: updated.id,
      detail: { employee_id: updated.employee_id, periode: updated.periode },
    });

    // Notifikasi hanya saat publish. Pesan disusun dari record di DB (event
    // payslip_published); notifikasi identik dalam 10 menit dianggap duplikat,
    // sama seperti /api/notifications/dispatch.
    if (publish) {
      try {
        const built = await NOTIFICATION_EVENTS.payslip_published.build({ admin, emp, id });
        if (built?.to?.userId) {
          const pesan = String(built.pesan).slice(0, MAKS_PESAN);
          const since = new Date(Date.now() - JENDELA_DUPLIKAT_MS).toISOString();
          const { data: dupe } = await admin
            .from('notifications')
            .select('id')
            .eq('user_id', built.to.userId)
            .eq('tipe', built.tipe)
            .eq('pesan', pesan)
            .gte('created_at', since)
            .limit(1);
          if (!dupe || dupe.length === 0) {
            await notifyEmployee(admin, { userId: built.to.userId, tipe: built.tipe, pesan, link: built.link });
          }
        }
      } catch (err) {
        console.error('Notifikasi payslip_published error:', err);
      }
    }

    return NextResponse.json({ success: true, is_published: publish, changed: true });
  } catch (err) {
    console.error('Publish slip gaji error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
