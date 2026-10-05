import nodemailer from 'nodemailer';
import { buildInterviewDetails, detailToText } from '@/lib/candidateMessages';

// Email ke pelamar (template interview / diterima / ditolak), dikirim dari
// opsi "Pesan" di halaman Pelamar. SERVER ONLY —
// jangan di-import dari komponen 'use client' (membaca kredensial SMTP).
//
// Env yang dibutuhkan (provider bebas: Resend, Brevo, Gmail app password, dll):
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
//   MAIL_FROM  mis. "Madael Consult <recruitment@madaelconsult.com>"
//   MAIL_REPLY_TO (opsional)

const COMPANY = 'Madael Consult';

// Email dwibahasa: blok Indonesia di atas, English di bawah. Status "Baru"
// sengaja tidak ada: itu status awal saat pelamar submit.
const STATUS_COPY = {
  Interview: {
    subject: { id: 'Undangan interview', en: 'Interview invitation' },
    body: {
      id: 'Selamat, Anda lolos ke tahap interview. Tim rekrutmen kami akan menemui Anda pada jadwal berikut:',
      en: 'Congratulations, you have been selected for an interview. Our recruitment team will meet you at the following schedule:',
    },
  },
  Ditolak: {
    subject: { id: 'Update status lamaran Anda', en: 'Update on your application' },
    body: {
      id: 'Terima kasih atas minat dan waktu yang telah Anda luangkan. Setelah kami pertimbangkan, saat ini kami belum dapat melanjutkan proses lamaran Anda. Kami menghargai lamaran Anda dan mendoakan yang terbaik untuk langkah karier Anda berikutnya.',
      en: 'Thank you for your interest and the time you have invested. After careful consideration, we are unable to move forward with your application at this time. We appreciate your application and wish you all the best in your career.',
    },
  },
  Diterima: {
    subject: { id: 'Selamat, lamaran Anda diterima', en: 'Congratulations, your application has been accepted' },
    body: {
      id: 'Selamat! Anda dinyatakan diterima. Tim kami akan segera menghubungi Anda untuk informasi langkah selanjutnya.',
      en: 'Congratulations! You have been accepted. Our team will contact you shortly with the next steps.',
    },
  },
};

export function isNotifiableStatus(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_COPY, status);
}

export function isMailConfigured() {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER &&
    process.env.SMTP_PASS && process.env.MAIL_FROM
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const LABELS = {
  id: {
    greeting: (nama) => `Yth. ${nama},`,
    lead: (posisi) => `Kami menginformasikan perkembangan lamaran Anda${posisi ? ` untuk posisi ${posisi}` : ''} di ${COMPANY}.`,
    detailsLater: 'Detail jadwal akan kami kirimkan terpisah.',
    questions: 'Jika ada pertanyaan, silakan balas email ini.',
    closing: 'Salam,',
    team: `Tim Rekrutmen ${COMPANY}`,
  },
  en: {
    greeting: (nama) => `Dear ${nama},`,
    lead: (posisi) => `We are writing to update you on your application${posisi ? ` for the ${posisi} position` : ''} at ${COMPANY}.`,
    detailsLater: 'Schedule details will be sent to you separately.',
    questions: 'If you have any questions, please reply to this email.',
    closing: 'Best regards,',
    team: `${COMPANY} Recruitment Team`,
  },
};

// Satu blok bahasa. `details` berisi [{ label?, value, href? }] — detail
// interview (jadwal, format, lokasi/alamat atau link meeting).
function buildBlock(lang, { nama, posisi, status, interviewAt, venue }) {
  const L = LABELS[lang];
  const copy = STATUS_COPY[status];

  let details = [];
  if (status === 'Interview') {
    details = buildInterviewDetails(lang, { interviewAt, venue });
    if (details.length === 0) details = [{ value: L.detailsLater }];
  }

  return {
    greeting: L.greeting(nama),
    lead: L.lead(posisi),
    body: copy.body[lang],
    details,
    questions: L.questions,
    closing: L.closing,
    team: L.team,
  };
}

function blockToText(b) {
  return [
    b.greeting, '', b.lead, '', b.body,
    ...(b.details.length ? ['', ...b.details.map(detailToText)] : []),
    '', b.questions, '', b.closing, b.team,
  ].join('\n');
}

// Link meeting dibuat bisa diklik; alamat multi-baris pakai <br>.
function detailToHtml(d) {
  const label = d.label ? `${escapeHtml(d.label)}: ` : '';
  const value = escapeHtml(d.value).replace(/\n/g, '<br>');
  return d.href ? `${label}<a href="${escapeHtml(d.href)}">${value}</a>` : `${label}${value}`;
}

function blockToHtml(b) {
  return `<p>${escapeHtml(b.greeting)}</p>
<p>${escapeHtml(b.lead)}</p>
<p>${escapeHtml(b.body)}</p>
${b.details.length ? `<p>${b.details.map(detailToHtml).join('<br>')}</p>` : ''}
<p>${escapeHtml(b.questions)}</p>
<p>${escapeHtml(b.closing)}<br>${escapeHtml(b.team)}</p>`;
}

export function buildContent(params) {
  const copy = STATUS_COPY[params.status];
  const id = buildBlock('id', params);
  const en = buildBlock('en', params);

  const text = `${blockToText(id)}\n\n----------\n\n${blockToText(en)}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222">
${blockToHtml(id)}
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">
${blockToHtml(en)}
</div>`;

  return {
    subject: `${copy.subject.id} / ${copy.subject.en} — ${COMPANY}`,
    text,
    html,
  };
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

// Lempar error kalau SMTP belum dikonfigurasi atau pengiriman gagal —
// pemanggil (route) yang memutuskan cara menyampaikannya ke admin.
// Mengembalikan { subject, text } yang benar-benar dikirim, supaya pemanggil
// bisa mencatatnya ke riwayat pelamar.
export async function sendApplicantStatusEmail({ to, nama, posisi, status, interviewAt, venue }) {
  if (!isNotifiableStatus(status)) throw new Error(`Status "${status}" tidak dikirimi email.`);
  if (!isMailConfigured()) throw new Error('SMTP belum dikonfigurasi.');

  const { subject, text, html } = buildContent({ nama, posisi, status, interviewAt, venue });
  await getTransporter().sendMail({
    from: process.env.MAIL_FROM,
    replyTo: process.env.MAIL_REPLY_TO || undefined,
    to,
    subject,
    text,
    html,
  });
  return { subject, text };
}