// Template pesan ke kandidat — bagian yang AMAN dipakai di client maupun server
// (tidak membaca env/SMTP, tidak meng-import nodemailer).
//
// Tiga template: lolos ke tahap interview, diterima, ditolak.
//   - Email     : isi & pengirimnya ada di lib/applicationEmail.js (server only),
//                 dipetakan lewat TEMPLATE_STATUS di bawah.
//   - WhatsApp  : teks dibuat di sini, lalu dibungkus jadi link wa.me. Sistem
//                 TIDAK mengirim apa pun; HR menekan Send di WhatsApp sendiri.

const COMPANY = 'Madael Consult';

// key template → status lamaran yang dipakai lib/applicationEmail.js
export const TEMPLATE_STATUS = {
  interview: 'Interview',
  diterima: 'Diterima',
  ditolak: 'Ditolak',
};

export const MESSAGE_TEMPLATES = [
  { key: 'interview', label: 'Lolos ke tahap interview', status: 'Interview' },
  { key: 'diterima', label: 'Diterima', status: 'Diterima' },
  { key: 'ditolak', label: 'Ditolak', status: 'Ditolak' },
];

export const CHANNELS = ['email', 'whatsapp'];

export function isMessageTemplate(key) {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_STATUS, key);
}

// Kebalikan TEMPLATE_STATUS: 'Interview' → 'interview' (null kalau tidak ada).
export function statusToTemplate(status) {
  return Object.keys(TEMPLATE_STATUS).find((k) => TEMPLATE_STATUS[k] === status) || null;
}

export function getTemplateLabel(key) {
  return MESSAGE_TEMPLATES.find((t) => t.key === key)?.label || key;
}

// ---------------------------------------------------------------------------
// Format & lokasi interview. Dua mode, dengan field berbeda:
//   offline : interview_location (nama tempat) + interview_address (alamat lengkap)
//   online  : interview_meeting_url (Zoom / Meet / Teams)
// Dipakai bersama oleh form jadwal, template WhatsApp, dan email.
// ---------------------------------------------------------------------------
export const INTERVIEW_MODES = [
  { key: 'offline', label: 'Offline (tatap muka)' },
  { key: 'online', label: 'Online (Zoom / Meet / Teams)' },
];

function cleanText(value) {
  const t = String(value ?? '').trim();
  return t || null;
}

// Alamat boleh beberapa baris; rapikan spasi & baris kosong.
function cleanMultiline(value) {
  const t = String(value ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
  return t || null;
}

// Hanya http(s) — mencegah skema berbahaya (javascript:, dll) masuk ke href email.
export function isHttpUrl(value) {
  try {
    const u = new URL(String(value ?? '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Baris `applications` → { mode, location, address, meetingUrl }. Baris lama
// yang belum punya interview_mode ditebak dari isinya.
export function getInterviewVenue(row) {
  const location = cleanText(row?.interview_location);
  const address = cleanMultiline(row?.interview_address);
  const meetingUrl = cleanText(row?.interview_meeting_url);

  let mode = row?.interview_mode === 'online' || row?.interview_mode === 'offline' ? row.interview_mode : null;
  if (!mode) mode = meetingUrl ? 'online' : location || address ? 'offline' : null;

  return mode === 'online'
    ? { mode, location: null, address: null, meetingUrl }
    : { mode, location, address, meetingUrl: null };
}

// Cukup lengkap untuk dikirim ke kandidat?
export function hasInterviewVenue(venue) {
  if (!venue) return false;
  return venue.mode === 'online' ? isHttpUrl(venue.meetingUrl) : Boolean(venue.address || venue.location);
}

const INTERVIEW_LABELS = {
  id: {
    schedule: 'Jadwal',
    format: 'Format',
    online: 'Online',
    offline: 'Tatap muka (offline)',
    venue: 'Lokasi',
    address: 'Alamat',
    meetingLink: 'Link meeting',
  },
  en: {
    schedule: 'Schedule',
    format: 'Format',
    online: 'Online',
    offline: 'In person',
    venue: 'Venue',
    address: 'Address',
    meetingLink: 'Meeting link',
  },
};

// Daftar detail interview untuk satu bahasa: [{ label, value, href? }].
// `href` hanya ada untuk link meeting yang valid, supaya email bisa
// membuatnya bisa diklik.
export function buildInterviewDetails(lang, { interviewAt, venue }) {
  const L = INTERVIEW_LABELS[lang];
  const details = [];

  const jadwal = formatJadwal(interviewAt, lang);
  if (jadwal) details.push({ label: L.schedule, value: jadwal });

  if (venue?.mode === 'online') {
    details.push({ label: L.format, value: L.online });
    if (venue.meetingUrl) {
      details.push({
        label: L.meetingLink,
        value: venue.meetingUrl,
        href: isHttpUrl(venue.meetingUrl) ? venue.meetingUrl : undefined,
      });
    }
  } else if (venue?.location || venue?.address) {
    details.push({ label: L.format, value: L.offline });
    if (venue.location) details.push({ label: L.venue, value: venue.location });
    if (venue.address) details.push({ label: L.address, value: venue.address });
  }

  return details;
}

export function detailToText(d) {
  return d.label ? `${d.label}: ${d.value}` : d.value;
}

function formatJadwal(iso, lang) {
  if (!iso) return null;
  return (
    new Date(iso).toLocaleString(lang === 'id' ? 'id-ID' : 'en-GB', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' WIB'
  );
}

// Teks WhatsApp per bahasa. Struktur mengikuti email: blok Indonesia di atas,
// English di bawah.
const WA_COPY = {
  id: {
    greeting: (nama) => `Halo ${nama || 'Kandidat'}, kami dari Tim Rekrutmen ${COMPANY}.`,
    forPosition: (posisi) => (posisi ? ` untuk posisi ${posisi}` : ''),
    applyPosition: (posisi) => (posisi ? ` posisi ${posisi}` : ''),
    interview: (fp) => `Selamat, Anda lolos ke tahap interview${fp}.`,
    interviewClose: 'Mohon konfirmasi kehadiran Anda dengan membalas pesan ini. Terima kasih.',
    diterima: (fp) => `Selamat! Anda dinyatakan diterima${fp} di ${COMPANY}.`,
    diterimaClose: 'Tim kami akan segera menghubungi Anda untuk informasi langkah selanjutnya. Terima kasih.',
    ditolak: (ap) => `Terima kasih atas minat dan waktu yang telah Anda luangkan untuk melamar${ap} di ${COMPANY}.`,
    ditolakClose:
      'Setelah kami pertimbangkan, saat ini kami belum dapat melanjutkan proses lamaran Anda. Kami menghargai lamaran Anda dan mendoakan yang terbaik untuk langkah karier Anda berikutnya.',
  },
  en: {
    greeting: (nama) => `Hello ${nama || 'Candidate'}, this is the ${COMPANY} Recruitment Team.`,
    forPosition: (posisi) => (posisi ? ` for the ${posisi} position` : ''),
    applyPosition: (posisi) => (posisi ? ` for the ${posisi} position` : ''),
    interview: (fp) => `Congratulations, you have been selected for an interview${fp}.`,
    interviewClose: 'Please confirm your attendance by replying to this message. Thank you.',
    diterima: (fp) => `Congratulations! You have been accepted${fp} at ${COMPANY}.`,
    diterimaClose: 'Our team will contact you shortly with the next steps. Thank you.',
    ditolak: (ap) => `Thank you for your interest and the time you have invested in applying${ap} at ${COMPANY}.`,
    ditolakClose:
      'After careful consideration, we are unable to move forward with your application at this time. We appreciate your application and wish you all the best in your career.',
  },
};

function buildWhatsAppBlock(lang, template, { nama, posisi, interviewAt, venue }) {
  const C = WA_COPY[lang];
  const lines = [C.greeting(nama), ''];

  if (template === 'interview') {
    lines.push(C.interview(C.forPosition(posisi)));
    const details = buildInterviewDetails(lang, { interviewAt, venue });
    if (details.length) lines.push('', ...details.map(detailToText));
    lines.push('', C.interviewClose);
  } else if (template === 'diterima') {
    lines.push(C.diterima(C.forPosition(posisi)), '', C.diterimaClose);
  } else if (template === 'ditolak') {
    lines.push(C.ditolak(C.applyPosition(posisi)), '', C.ditolakClose);
  } else {
    throw new Error(`Template tidak dikenal: ${template}`);
  }

  return lines.join('\n');
}

// Teks WhatsApp dwibahasa (Indonesia di atas, English di bawah — sama seperti
// email). Dipanggil client untuk preview DAN server untuk isi yang dicatat ke
// riwayat — server tidak memakai teks kiriman client.
export function buildWhatsAppText(template, params) {
  return `${buildWhatsAppBlock('id', template, params)}\n\n----------\n\n${buildWhatsAppBlock('en', template, params)}`;
}

// Nomor telepon pelamar diisi bebas di form (0812-3456-7890, +62 812..., 812...).
// Kembalikan format wa.me (digit saja, awalan 62), atau null kalau tidak bisa
// dipakai untuk WhatsApp. Nomor luar negeri hanya diterima kalau ditulis
// dengan "+" (mis. +65 ...); tanpa itu kode negaranya tidak bisa ditebak.
export function normalizeWaNumber(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const hasPlus = text.startsWith('+');
  let digits = text.replace(/\D/g, '');
  if (!digits) return null;

  if (hasPlus && !digits.startsWith('62')) {
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }

  if (digits.startsWith('00')) digits = digits.slice(2); // awalan internasional 00
  if (digits.startsWith('62')) {
    if (digits[2] === '0') digits = '62' + digits.slice(3); // "+62 0812..." salah ketik
  } else if (digits.startsWith('0')) {
    digits = '62' + digits.slice(1);
  } else if (digits.startsWith('8')) {
    digits = '62' + digits;
  } else {
    return null;
  }

  // Seluler Indonesia: 62 8xx xxxx xxxx (total 11–14 digit). Telepon rumah
  // (021, dst) tidak punya WhatsApp.
  if (!/^628\d{8,11}$/.test(digits)) return null;
  return digits;
}

export function buildWaLink(phone, text) {
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
