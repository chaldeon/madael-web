import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';

// GET /api/feedback/unread — jumlah TIKET milik user yang punya balasan support
// yang belum dibuka (badge di bubble). Dipoll berkala oleh FeedbackBubble, jadi
// dibuat semurah mungkin: satu count query ke partial index (user_unread).
export async function GET() {
  try {
    const session = await getSessionEmployee('id, status');
    if (session.error) return NextResponse.json({ error: session.error }, { status: session.status });

    const admin = createAdminClient();
    const { count, error } = await admin
      .from('feedback_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('employee_id', session.emp.id)
      .eq('user_unread', true);

    if (error) return NextResponse.json({ error: 'Gagal memuat.' }, { status: 500 });
    return NextResponse.json({ count: count || 0 });
  } catch (err) {
    console.error('Feedback unread error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
