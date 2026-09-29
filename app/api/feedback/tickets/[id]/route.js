import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { logActivity } from '@/lib/activityLog';
import { isUuid, withSignedUrls } from '@/lib/feedbackServer';

// GET /api/feedback/tickets/[id] — detail tiket + seluruh pesan (urut waktu).
// Hanya pemilik tiket. Nama pembalas diambil dari snapshot author_nama.
// Efek samping: membuka tiket = menandai balasan support sebagai sudah dibaca
// (badge bubble berkurang). Tidak mengubah updated_at / urutan antrean.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Tiket tidak ditemukan.' }, { status: 404 });

    const session = await getSessionEmployee('id, status');
    if (session.error) return NextResponse.json({ error: session.error }, { status: session.status });

    const admin = createAdminClient();
    const { data: ticket } = await admin
      .from('feedback_tickets')
      .select('id, ticket_no, jenis, modul_label, halaman, status, last_staff_nama, last_staff_at, user_unread, closed_by, closed_by_nama, created_at, updated_at, closed_at')
      .eq('id', id)
      .eq('employee_id', session.emp.id)
      .maybeSingle();

    if (!ticket) return NextResponse.json({ error: 'Tiket tidak ditemukan.' }, { status: 404 });

    const { data: messages, error } = await admin
      .from('feedback_messages')
      .select('id, author_nama, is_staff, isi, attachment_path, attachment_name, attachment_mime, created_at')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });

    if (error) return NextResponse.json({ error: 'Gagal memuat pesan.' }, { status: 500 });

    // Penanda baca = waktu balasan support TERAKHIR yang benar-benar ikut terkirim
    // di respons ini (bukan now()), jadi balasan yang masuk di sela request tetap
    // dihitung belum dibaca.
    let markedRead = false;
    if (ticket.user_unread) {
      const lastStaffSeen = [...(messages || [])].reverse().find((m) => m.is_staff)?.created_at;
      if (lastStaffSeen) {
        const { error: readError } = await admin
          .from('feedback_tickets')
          .update({ user_last_read_at: lastStaffSeen })
          .eq('id', id);
        markedRead = !readError;
      }
    }

    const signed = await withSignedUrls(admin, messages || []);
    // path internal storage tidak perlu sampai ke browser
    const safe = signed.map(({ attachment_path, ...rest }) => rest);

    const { closed_by, user_unread, last_staff_at, ...rest } = ticket;
    return NextResponse.json({
      ticket: {
        ...rest,
        // Tombol 'Tandai Selesai' hanya muncul setelah tim support menjawab.
        can_close: ticket.status !== 'selesai' && !!last_staff_at,
        closed_by_self: !!closed_by && closed_by === session.emp.id,
      },
      messages: safe,
      marked_read: markedRead,
    });
  } catch (err) {
    console.error('Feedback detail error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

// PATCH /api/feedback/tickets/[id] — pemilik menandai tiketnya selesai:
// { status: 'selesai' }. Hanya itu yang boleh dilakukan pengguna; dan hanya
// setelah tim support menjawab (juga ditegakkan trigger di DB). Tiket tidak
// dihapus — pindah ke Riwayat, dan terbuka lagi bila pengguna kirim pesan baru.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Tiket tidak ditemukan.' }, { status: 404 });

    const session = await getSessionEmployee('id, nama, status');
    if (session.error) return NextResponse.json({ error: session.error }, { status: session.status });
    const { emp } = session;

    const body = await request.json().catch(() => ({}));
    if (body?.status !== 'selesai') {
      return NextResponse.json({ error: 'Pengguna hanya bisa menandai tiket selesai.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: ticket } = await admin
      .from('feedback_tickets')
      .select('id, ticket_no, status, last_staff_at')
      .eq('id', id)
      .eq('employee_id', emp.id)
      .maybeSingle();
    if (!ticket) return NextResponse.json({ error: 'Tiket tidak ditemukan.' }, { status: 404 });
    if (ticket.status === 'selesai') return NextResponse.json({ success: true });
    if (!ticket.last_staff_at) {
      return NextResponse.json(
        { error: 'Tiket bisa ditandai selesai setelah dijawab tim support.' },
        { status: 400 }
      );
    }

    // closed_by = pemilik; nama penutup diisi trigger DB dari employees.nama.
    const { error } = await admin
      .from('feedback_tickets')
      .update({ status: 'selesai', closed_by: emp.id })
      .eq('id', id);
    if (error) {
      console.error('Feedback close error:', error);
      return NextResponse.json({ error: 'Gagal menandai selesai. Coba lagi.' }, { status: 500 });
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_status_tiket_feedback',
      targetTable: 'feedback_tickets',
      targetId: id,
      detail: { ticket_no: ticket.ticket_no, dari: ticket.status, ke: 'selesai', oleh: 'pengguna' },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Feedback close error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
