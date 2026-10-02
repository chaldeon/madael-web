import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { isModuleGranted } from '@/lib/employeeModules';
import { logActivity } from '@/lib/activityLog';
import {
  isNotifiableStatus,
  isMailConfigured,
  sendApplicantStatusEmail,
} from '@/lib/applicationEmail';
import { recordApplicationMessage } from '@/lib/applicationMessages';
import { statusToTemplate } from '@/lib/candidateMessages';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/applications/[id]/status-email   body: { status }
// Dipanggil dari halaman Pelamar SETELAH status berhasil diubah. Email dikirim
// berdasarkan status yang tersimpan di database (bukan kiriman client), jadi
// endpoint ini tidak bisa dipakai untuk mengirim isi email sembarang. Body
// `status` hanya dipakai untuk mendeteksi data basi (409).
//
// Akses: superadmin atau pemegang modul job_portal.
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const session = await getSessionEmployee('id, nama, status, is_superadmin');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { emp } = session;
    const admin = createAdminClient();

    const { data: mods, error: modsError } = await admin
      .from('employee_modules')
      .select('module_name')
      .eq('employee_id', emp.id)
      .eq('module_name', 'job_portal');
    if (modsError) throw modsError;

    const allowed = isModuleGranted({
      isSuperadmin: emp.is_superadmin,
      moduleKeys: (mods || []).map((m) => m.module_name),
      key: 'job_portal',
    });
    if (!allowed) {
      return NextResponse.json({ error: 'Anda tidak punya akses ke modul Job Portal.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));

    const { data: app, error } = await admin
      .from('applications')
      .select('id, nama, email, status, job_id, interview_at, interview_location, job_listings ( title )')
      .eq('id', id)
      .maybeSingle();

    if (error || !app) {
      return NextResponse.json({ error: 'Lamaran tidak ditemukan.' }, { status: 404 });
    }

    if (body.status && body.status !== app.status) {
      return NextResponse.json(
        { error: 'Status lamaran sudah berubah lagi. Muat ulang halaman.' },
        { status: 409 }
      );
    }

    if (!isNotifiableStatus(app.status)) {
      return NextResponse.json({ success: true, skipped: true });
    }

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
        posisi: app.job_listings?.title || null,
        status: app.status,
        interviewAt: app.interview_at,
        interviewLocation: app.interview_location,
      });
    } catch (sendErr) {
      console.error('Kirim email status pelamar gagal:', sendErr);
      return NextResponse.json({ error: 'Email ke pelamar gagal dikirim.' }, { status: 502 });
    }

    // Catat ke riwayat pesan pelamar. Gagal mencatat tidak membatalkan
    // apa pun — email-nya sudah terkirim.
    await recordApplicationMessage(admin, {
      application_id: app.id,
      channel: 'email',
      template: statusToTemplate(app.status),
      source: 'otomatis',
      status: 'terkirim',
      recipient: app.email,
      subject: sent.subject,
      body: sent.text,
      sent_by: emp.id,
      sent_by_nama: emp.nama || null,
    });

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'email_status_pelamar',
      targetTable: 'applications',
      targetId: app.id,
      detail: { status: app.status },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Status-email API unexpected error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan pada server.' }, { status: 500 });
  }
}
