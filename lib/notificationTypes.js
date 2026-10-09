// Metadata tampilan untuk kolom `notifications.tipe` — dipakai lonceng
// (components/NotificationBell.js) dan Pusat Notifikasi
// (app/employee/notifications). Satu sumber supaya ikon dan kategori konsisten.
//
// Nilai `tipe` dibuat di banyak tempat (lib/notify.js dipanggil dari halaman
// dan rute API), sebagian dirakit dinamis (mis. `cuti_${decision}`), jadi
// pencocokan memakai AWALAN, bukan daftar nilai tetap. Tipe baru yang belum
// terdaftar jatuh ke kategori "Lainnya" dengan ikon lonceng — tidak error.

import {
  Bell,
  CalendarDays,
  Clock,
  ClipboardCheck,
  Receipt,
  UserCog,
  Wallet,
  Megaphone,
  LifeBuoy,
  Briefcase,
} from 'lucide-react';

// Nama event window — dikirim setelah notifikasi ditandai dibaca supaya
// lonceng dan halaman Pusat Notifikasi (yang bisa terbuka bersamaan)
// saling menyegarkan tanpa menunggu polling.
export const NOTIFICATIONS_CHANGED_EVENT = 'notifications:changed';

// Urutan penting: aturan yang lebih spesifik harus di atas aturan umum
// (mis. `koreksi_absensi_` sebelum yang lain). Tiap aturan: awalan tipe -> kategori.
const CATEGORIES = {
  cuti: { label: 'Cuti', icon: CalendarDays },
  lembur: { label: 'Lembur', icon: Clock },
  absensi: { label: 'Absensi', icon: ClipboardCheck },
  reimbursement: { label: 'Reimbursement', icon: Receipt },
  profil: { label: 'Profil', icon: UserCog },
  gaji: { label: 'Gaji', icon: Wallet },
  pengumuman: { label: 'Pengumuman', icon: Megaphone },
  bantuan: { label: 'Bantuan', icon: LifeBuoy },
  rekrutmen: { label: 'Rekrutmen', icon: Briefcase },
  lainnya: { label: 'Lainnya', icon: Bell },
};

const PREFIX_RULES = [
  ['cuti_', 'cuti'],
  ['lembur_', 'lembur'],
  ['koreksi_absensi_', 'absensi'],
  ['absensi_', 'absensi'],
  ['reimbursement_', 'reimbursement'],
  ['profil_', 'profil'],
  ['payroll_', 'gaji'],
  ['payslip_', 'gaji'],
  ['pengumuman_', 'pengumuman'],
  ['tiket_', 'bantuan'],
  ['pelamar_', 'rekrutmen'],
  ['interview_', 'rekrutmen'],
  ['reviewer_', 'rekrutmen'],
];

// Hasil akhir keputusan, dilihat dari akhiran `tipe` — dipakai untuk memberi
// warna ikon (hijau = disetujui/selesai, merah = ditolak/dibatalkan).
const SUCCESS_RE = /(disetujui|approved|paid|published)$/;
const DANGER_RE = /(ditolak|rejected|dibatalkan|cancelled)$/;

const TONE_CLASS = {
  success: 'bg-green-100 text-green-700',
  danger: 'bg-red-100 text-red-700',
  neutral: 'bg-[#F4F4F4] text-[#6B6B6B]',
};

export function getNotificationCategoryKey(tipe) {
  const value = typeof tipe === 'string' ? tipe : '';
  const rule = PREFIX_RULES.find(([prefix]) => value.startsWith(prefix));
  return rule ? rule[1] : 'lainnya';
}

// Return { categoryKey, label, Icon, iconClass } untuk satu nilai `tipe`.
export function getNotificationMeta(tipe) {
  const categoryKey = getNotificationCategoryKey(tipe);
  const category = CATEGORIES[categoryKey];
  const value = typeof tipe === 'string' ? tipe : '';
  const tone = SUCCESS_RE.test(value) ? 'success' : DANGER_RE.test(value) ? 'danger' : 'neutral';
  return {
    categoryKey,
    label: category.label,
    Icon: category.icon,
    iconClass: TONE_CLASS[tone],
  };
}

// Daftar kategori untuk filter di halaman Pusat Notifikasi: [{ key, label }].
export const NOTIFICATION_CATEGORY_OPTIONS = Object.entries(CATEGORIES).map(([key, c]) => ({
  key,
  label: c.label,
}));
