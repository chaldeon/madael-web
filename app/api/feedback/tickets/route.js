import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { FEEDBACK_JENIS_LABEL, resolveModuleTag } from '@/lib/feedbackConfig';
import {
  cleanPath, readFile, readIsi, validateIsi, validateFile,
  uploadAttachment, discardUploaded, overRateLimit, notifySupportTeam,
} from '@/lib/feedbackServer';

const MAX_TICKETS_PER_HOUR = 10;

// GET /api/feedback/tickets — daftar tiket milik user yang login.
// Satu daftar; filter status (Semua/Baru/Diproses/Selesai) dilakukan di client.
// Tiket selesai tetap ada dan tidak pernah dihapus.
export async function GET() {
  try {
    const session = await getSessionEmployee('id, status');
    if (session.error) return NextResponse.json({ error: session.error }, { status: session.status });

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('feedback_tickets')
      .select('id, ticket_no, jenis, modul_label, ringkasan, status, last_staff_nama, last_staff_at, last_message_is_staff, user_unread, created_at, updated_at, closed_at')
      .eq('employee_id', session.emp.id)
      .order('updated_at', { ascending: false })
      .limit(200);

    if (error) return NextResponse.json({ error: 'Gagal memuat tiket.' }, { status: 500 });
    return NextResponse.json({ tickets: data || [] });
  } catch (err) {
    console.error('Feedback list error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

// POST /api/feedback/tickets — buat tiket baru (multipart: jenis, isi, halaman, file?).
export async function POST(request) {
  let admin;
  let att = null;
  try {
    const session = await getSessionEmployee('id, nama, status');
    if (session.error) return NextResponse.json({ error: session.error }, { status: session.status });
    const { emp } = session;

    const form = await request.formData();
    const jenis = String(form.get('jenis') || '');
    const isi = readIsi(form);
    const file = readFile(form);

    if (!FEEDBACK_JENIS_LABEL[jenis]) {
      return NextResponse.json({ error: 'Jenis tiket tidak valid.' }, { status: 400 });
    }
    const invalid = validateIsi(isi) || validateFile(file);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    admin = createAdminClient();
    if (await overRateLimit(admin, 'feedback_tickets', 'employee_id', emp.id, MAX_TICKETS_PER_HOUR)) {
      return NextResponse.json(
        { error: 'Terlalu banyak tiket dalam 1 jam terakhir. Coba lagi nanti atau balas di tiket yang sudah ada.' },
        { status: 429 }
      );
    }

    // Modul dihitung ulang di server dari path — tidak percaya key dari client.
    const halaman = cleanPath(form.get('halaman'));
    const tag = resolveModuleTag(halaman);

    if (file) att = await uploadAttachment(admin, emp.id, file);

    const { data: ticketId, error } = await admin.rpc('feedback_create_ticket', {
      p_employee_id: emp.id,
      p_jenis: jenis,
      p_modul: tag.key,
      p_modul_label: tag.label,
      p_halaman: halaman,
      p_isi: isi,
      p_att_path: att?.path ?? null,
      p_att_name: att?.name ?? null,
      p_att_mime: att?.mime ?? null,
    });

    if (error) {
      console.error('Feedback create error:', error);
      await discardUploaded(admin, att);
      return NextResponse.json({ error: 'Gagal mengirim tiket. Coba lagi.' }, { status: 500 });
    }

    // Kabari tim support (lonceng). Nomor tiket dibuat DB, jadi diambil dulu.
    const { data: created } = await admin
      .from('feedback_tickets')
      .select('ticket_no')
      .eq('id', ticketId)
      .maybeSingle();
    await notifySupportTeam(admin, { id: ticketId }, {
      tipe: 'tiket_baru',
      pesan: `Tiket baru${created ? ` #${created.ticket_no}` : ''} (${tag.label}) dari ${emp.nama}: ${FEEDBACK_JENIS_LABEL[jenis]}.`,
      excludeId: emp.id,
    });

    return NextResponse.json({ success: true, id: ticketId }, { status: 201 });
  } catch (err) {
    console.error('Feedback create error:', err);
    if (admin) await discardUploaded(admin, att);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
