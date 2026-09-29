import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { isUuid, withSignedUrls } from '@/lib/feedbackServer';

// GET /api/feedback/tickets/[id] — detail tiket + seluruh pesan (urut waktu).
// Hanya pemilik tiket. Nama pembalas diambil dari snapshot author_nama.
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Tiket tidak ditemukan.' }, { status: 404 });

    const session = await getSessionEmployee('id, status');
    if (session.error) return NextResponse.json({ error: session.error }, { status: session.status });

    const admin = createAdminClient();
    const { data: ticket } = await admin
      .from('feedback_tickets')
      .select('id, ticket_no, jenis, modul_label, halaman, status, last_staff_nama, created_at, updated_at, closed_at')
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

    const signed = await withSignedUrls(admin, messages || []);
    // path internal storage tidak perlu sampai ke browser
    const safe = signed.map(({ attachment_path, ...rest }) => rest);
    return NextResponse.json({ ticket, messages: safe });
  } catch (err) {
    console.error('Feedback detail error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
