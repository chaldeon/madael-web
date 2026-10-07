import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { EMAIL_RE, isMailConfigured, sendApplicantStatusEmail } from '@/lib/applicationEmail';
import { canAccessJob, checkApplicationScope, OUT_OF_SCOPE_ERROR } from '@/lib/jobPortalServer';
import {
  MESSAGE_COLUMNS,
  recordApplicationMessage,
  requireJobPortalAccess,
} from '@/lib/applicationMessages';
import {
  CHANNELS,
  TEMPLATE_STATUS,
  isMessageTemplate,
  buildWaLink,
  buildWhatsAppText,
  normalizeWaNumber,
  getInterviewVenue,
  hasInterviewVenue,
} from '@/lib/candidateMessages';

// GET /api/applications/[id]/messages
// Riwayat pesan ke satu pelamar (terbaru di atas).
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    const access = await requireJobPortalAccess(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

    const scopeCheck = await checkApplicationScope(admin, access.scope, id);
    if (scopeCheck.error) return NextResponse.json({ error: scopeCheck.error }, { status: scopeCheck.status });

    const { data, error } = await admin
      .from('application_messages')
      .select(MESSAGE_COLUMNS)
      .eq('application_id', id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Muat riwayat pesan pelamar gagal:', error);
      return NextResponse.json(
        { error: 'Riwayat pesan belum bisa dimuat. Pastikan migrasi SQL application_messages sudah dijalankan.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ messages: data || [] });
  } catch (err) {
    console.error('Messages GET unexpected error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}

// POST /api/applications/[id]/messages   body: { template, channel }
//   template : 'interview' | 'diterima' | 'ditolak'
//   channel  : 'email'     → email dikirim SEKARANG dari server
//              'whatsapp'  → server membuat link wa.me; HR menekan Send sendiri
//
// Isi pesan SELALU dibuat di server dari data pelamar di database — body
// request tidak bisa dipakai untuk mengirim teks sembarang.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const admin = createAdminClient();

    const access = await requireJobPortalAccess(admin);
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    const { emp, scope } = access;

    const body = await request.json().catch(() => ({}));
    const { template, channel } = body;

    if (!isMessageTemplate(template)) {
      return NextResponse.json({ error: 'Template tidak valid.' }, { status: 400 });
    }
    if (!CHANNELS.includes(channel)) {
      return NextResponse.json({ error: 'Channel tidak valid.' }, { status: 400 });
    }

    const { data: app, error } = await admin
      .from('applications')
      .select('id, nama, email, telepon, status, job_id, interview_at, interview_mode, interview_location, interview_address, interview_meeting_url, job_listings ( title )')
      .eq('id', id)
      .maybeSingle();

    if (error || !app) {
      return NextResponse.json({ error: 'Lamaran tidak ditemukan.' }, { status: 404 });
    }
    if (!canAccessJob(scope, app.job_id)) {
      return NextResponse.json({ error: OUT_OF_SCOPE_ERROR }, { status: 403 });
    }

    // Template interview tanpa jadwal/lokasi akan terkirim setengah jadi; minta
    // HR melengkapinya dulu supaya kandidat langsung tahu kapan & di mana
    // (alamat lengkap untuk offline, link untuk online).
    const venue = getInterviewVenue(app);
    if (template === 'interview') {
      if (!app.interview_at) {
        return NextResponse.json(
          { error: 'Jadwalkan interview dulu sebelum mengirim template interview.' },
          { status: 422 }
        );
      }
      if (!hasInterviewVenue(venue)) {
        return NextResponse.json(
          { error: 'Lokasi atau link meeting interview belum diisi. Lengkapi lewat "Ubah jadwal" dulu.' },
          { status: 422 }
        );
      }
    }

    const posisi = app.job_listings?.title || null;
    const baseRow = {
      application_id: app.id,
      channel,
      template,
      source: 'manual',
      sent_by: emp.id,
      sent_by_nama: emp.nama || null,
    };
    const activityDetail = { nama: app.nama, posisi: posisi || 'CV Umum', template, channel };

    // ---------- WhatsApp: hanya buat link ----------
    if (channel === 'whatsapp') {
      const phone = normalizeWaNumber(app.telepon);
      if (!phone) {
        return NextResponse.json(
          { error: 'Nomor telepon pelamar kosong atau bukan nomor WhatsApp yang valid.' },
          { status: 422 }
        );
      }

      const text = buildWhatsAppText(template, {
        nama: app.nama,
        posisi,
        interviewAt: app.interview_at,
        venue,
      });
      const waUrl = buildWaLink(phone, text);

      const { data: message } = await recordApplicationMessage(admin, {
        ...baseRow,
        status: 'wa_dibuka',
        recipient: phone,
        body: text,
      });

      await logActivity(admin, {
        userId: emp.id,
        aksi: 'kirim_pesan_kandidat',
        targetTable: 'applications',
        targetId: app.id,
        detail: activityDetail,
      });

      return NextResponse.json({ success: true, waUrl, message: message || null, historyRecorded: Boolean(message) });
    }

    // ---------- Email: dikirim otomatis ----------
    if (!EMAIL_RE.test(app.email || '')) {
      return NextResponse.json({ error: 'Email pelamar tidak valid.' }, { status: 422 });
    }
    if (!isMailConfigured()) {
      return NextResponse.json(
        { error: 'Email belum dikonfigurasi di server (SMTP_* / MAIL_FROM).' },
        { status: 503 }
      );
    }

    let sent;
    try {
      sent = await sendApplicantStatusEmail({
        to: app.email,
        nama: app.nama,
        posisi,
        status: TEMPLATE_STATUS[template],
        interviewAt: app.interview_at,
        venue,
      });
    } catch (sendErr) {
      console.error('Kirim email template pelamar gagal:', sendErr);
      // Percobaan yang gagal juga dicatat, supaya HR tahu pesan itu TIDAK sampai.
      await recordApplicationMessage(admin, {
        ...baseRow,
        status: 'gagal',
        recipient: app.email,
        body: '(email tidak terkirim)',
        error: String(sendErr?.message || sendErr).slice(0, 300),
      });
      return NextResponse.json({ error: 'Email ke pelamar gagal dikirim.' }, { status: 502 });
    }

    const { data: message } = await recordApplicationMessage(admin, {
      ...baseRow,
      status: 'terkirim',
      recipient: app.email,
      subject: sent.subject,
      body: sent.text,
    });

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'kirim_pesan_kandidat',
      targetTable: 'applications',
      targetId: app.id,
      detail: activityDetail,
    });

    return NextResponse.json({ success: true, message: message || null, historyRecorded: Boolean(message) });
  } catch (err) {
    console.error('Messages POST unexpected error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}
