import { NextResponse } from 'next/server';
import {
  isUuid, readFile, readIsi, requireSupportAccess, validateIsi, validateFile,
  uploadAttachment, discardUploaded, notifyTicketReply,
} from '@/lib/feedbackServer';

// POST /api/feedback/admin/tickets/[id]/messages — balasan staff (multipart: isi, file?).
// Nama yang tampil ke user ('Dijawab oleh') diisi trigger DB dari employees.nama
// akun yang sedang login — tidak bisa diisi/dipalsukan dari request. Pesan
// tidak bisa diedit/dihapus setelah terkirim. Balasan pertama pada tiket 'baru'
// otomatis mengubahnya jadi 'diproses' (trigger DB).
export async function POST(request, { params }) {
  let admin;
  let att = null;
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Tiket tidak ditemukan.' }, { status: 404 });

    const gate = await requireSupportAccess();
    if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });
    ({ admin } = gate);
    const { emp } = gate;

    const { data: ticket } = await admin
      .from('feedback_tickets')
      .select('id, ticket_no, employee_id, modul_label')
      .eq('id', id)
      .maybeSingle();
    if (!ticket) return NextResponse.json({ error: 'Tiket tidak ditemukan.' }, { status: 404 });

    const form = await request.formData();
    const isi = readIsi(form);
    const file = readFile(form);
    const invalid = validateIsi(isi) || validateFile(file);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    if (file) att = await uploadAttachment(admin, emp.id, file);

    const { error } = await admin.from('feedback_messages').insert([{
      ticket_id: id,
      author_id: emp.id,
      author_nama: emp.nama,
      is_staff: true,
      isi,
      attachment_path: att?.path ?? null,
      attachment_name: att?.name ?? null,
      attachment_mime: att?.mime ?? null,
    }]);

    if (error) {
      console.error('Support reply error:', error);
      await discardUploaded(admin, att);
      return NextResponse.json({ error: 'Gagal mengirim balasan. Coba lagi.' }, { status: 500 });
    }

    // Kabari pemilik tiket lewat lonceng (kecuali membalas tiket miliknya sendiri).
    if (ticket.employee_id !== emp.id) await notifyTicketReply(admin, ticket, emp.nama);

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    console.error('Support reply error:', err);
    if (admin) await discardUploaded(admin, att);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
