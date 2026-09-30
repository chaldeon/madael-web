import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/activityLog';
import { isUuid, requireSupportAccess, withSignedUrls } from '@/lib/feedbackServer';

const STATUSES = ['baru', 'diproses', 'selesai'];

// GET /api/feedback/admin/tickets/[id] — detail tiket + seluruh pesan (urut waktu).
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Tiket tidak ditemukan.' }, { status: 404 });

    const gate = await requireSupportAccess();
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const { admin, emp } = gate;

    const { data: ticket } = await admin
      .from('feedback_tickets')
      .select('id, ticket_no, employee_id, employee_nama, jenis, modul_label, halaman, status, last_staff_nama, last_message_is_staff, closed_by, closed_by_nama, created_at, updated_at, closed_at')
      .eq('id', id)
      .maybeSingle();
    if (!ticket) return NextResponse.json({ error: 'Tiket tidak ditemukan.' }, { status: 404 });

    const { data: messages, error } = await admin
      .from('feedback_messages')
      .select('id, author_nama, is_staff, isi, attachment_path, attachment_name, attachment_mime, created_at')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });
    if (error) return NextResponse.json({ error: 'Gagal memuat pesan.' }, { status: 500 });

    const signed = await withSignedUrls(admin, messages || []);
    const safe = signed.map(({ attachment_path, ...rest }) => rest);
    // viewer_nama: nama yang akan tampil ke user sebagai 'Dijawab oleh'
    const { employee_id, closed_by, ...rest } = ticket;
    return NextResponse.json({
      ticket: { ...rest, closed_by_owner: !!closed_by && closed_by === employee_id },
      messages: safe,
      viewer_nama: emp.nama,
    });
  } catch (err) {
    console.error('Support detail error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

// PATCH /api/feedback/admin/tickets/[id] — ubah status: { status: 'baru'|'diproses'|'selesai' }.
// Hanya status yang berubah (trigger di DB mengunci kolom lain); 'selesai' cuma
// menandai tiket selesai (tetap ada di daftar, filter 'Selesai'), bukan menghapus.
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Tiket tidak ditemukan.' }, { status: 404 });

    const gate = await requireSupportAccess();
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const { admin, emp } = gate;

    const body = await request.json().catch(() => ({}));
    if (!STATUSES.includes(body?.status)) {
      return NextResponse.json({ error: 'Status tidak valid.' }, { status: 400 });
    }

    const { data: ticket } = await admin
      .from('feedback_tickets')
      .select('id, ticket_no, status')
      .eq('id', id)
      .maybeSingle();
    if (!ticket) return NextResponse.json({ error: 'Tiket tidak ditemukan.' }, { status: 404 });
    if (ticket.status === body.status) return NextResponse.json({ success: true });

    // Saat menutup, catat siapa penutupnya (nama diisi trigger DB dari employees.nama).
    const changes = body.status === 'selesai' ? { status: 'selesai', closed_by: emp.id } : { status: body.status };
    const { error } = await admin.from('feedback_tickets').update(changes).eq('id', id);
    if (error) {
      console.error('Support status error:', error);
      return NextResponse.json({ error: 'Gagal mengubah status.' }, { status: 500 });
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'ubah_status_tiket_feedback',
      targetTable: 'feedback_tickets',
      targetId: id,
      detail: { ticket_no: ticket.ticket_no, dari: ticket.status, ke: body.status },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Support status error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
