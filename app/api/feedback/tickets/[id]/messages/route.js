import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import {
  isUuid, readFile, readIsi, validateIsi, validateFile,
  uploadAttachment, discardUploaded, overRateLimit, notifySupportTeam,
} from '@/lib/feedbackServer';

const MAX_MESSAGES_PER_HOUR = 30;

// POST /api/feedback/tickets/[id]/messages — pesan lanjutan dari pemilik tiket
// (multipart: isi, file?). Hanya INSERT: pesan yang sudah terkirim tidak bisa
// diedit/dihapus (ditegakkan trigger di database). Kalau tiket sudah 'selesai',
// trigger otomatis membukanya lagi jadi 'baru'.
export async function POST(request, { params }) {
  let admin;
  let att = null;
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Tiket tidak ditemukan.' }, { status: 404 });

    const session = await getSessionEmployee('id, nama, status');
    if (session.error) return NextResponse.json({ error: session.error }, { status: session.status });
    const { emp } = session;

    admin = createAdminClient();
    const { data: ticket } = await admin
      .from('feedback_tickets')
      .select('id, ticket_no, modul_label')
      .eq('id', id)
      .eq('employee_id', emp.id)
      .maybeSingle();
    if (!ticket) return NextResponse.json({ error: 'Tiket tidak ditemukan.' }, { status: 404 });

    const form = await request.formData();
    const isi = readIsi(form);
    const file = readFile(form);
    const invalid = validateIsi(isi) || validateFile(file);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    if (await overRateLimit(admin, 'feedback_messages', 'author_id', emp.id, MAX_MESSAGES_PER_HOUR)) {
      return NextResponse.json({ error: 'Terlalu banyak pesan dalam 1 jam terakhir. Coba lagi nanti.' }, { status: 429 });
    }

    if (file) att = await uploadAttachment(admin, emp.id, file);

    // author_nama ditimpa trigger dari employees.nama (tidak bisa dipalsukan).
    const { error } = await admin.from('feedback_messages').insert([{
      ticket_id: id,
      author_id: emp.id,
      author_nama: emp.nama,
      is_staff: false,
      isi,
      attachment_path: att?.path ?? null,
      attachment_name: att?.name ?? null,
      attachment_mime: att?.mime ?? null,
    }]);

    if (error) {
      console.error('Feedback message error:', error);
      await discardUploaded(admin, att);
      return NextResponse.json({ error: 'Gagal mengirim pesan. Coba lagi.' }, { status: 500 });
    }

    // Kabari tim support (lonceng): pengguna menunggu balasan / tiket dibuka lagi.
    await notifySupportTeam(admin, ticket, {
      tipe: 'tiket_pesan_baru',
      pesan: `Pesan baru di tiket #${ticket.ticket_no} (${ticket.modul_label}) dari ${emp.nama}.`,
      excludeId: emp.id,
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error('Feedback message error:', err);
    if (admin) await discardUploaded(admin, att);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
