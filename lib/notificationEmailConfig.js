// Konfigurasi kategori email notifikasi — aman dipakai di klien maupun server
// (tanpa import khusus-server). Satu sumber untuk:
//   - memetakan `notifications.tipe` -> kategori email (lib/notificationEmail.js)
//   - label dan deskripsi di panel "Preferensi Email" (Pusat Notifikasi)
//   - nama kolom di tabel notification_preferences
//
// Pemetaan memakai daftar tipe EKSPLISIT (bukan awalan seperti
// lib/notificationTypes.js): tipe baru atau tipe yang tidak disebut di sini
// TIDAK dikirimi email. Jadi menambah tipe notifikasi baru tidak otomatis
// memicu email; harus dipilih sengaja.

export const EMAIL_CATEGORIES = {
  pengajuan: {
    column: 'email_pengajuan',
    label: 'Pengajuan masuk',
    description: 'Ada pengajuan karyawan yang perlu kamu tinjau (cuti, lembur, koreksi absensi, profil, reimbursement). Hanya relevan bila kamu penyetuju.',
    subject: 'Ada pengajuan baru yang perlu kamu tinjau',
  },
  keputusan: {
    column: 'email_keputusan',
    label: 'Keputusan atas pengajuanmu',
    description: 'Pengajuanmu disetujui, ditolak, dibatalkan, atau datamu dikoreksi admin.',
    subject: 'Update atas pengajuanmu',
  },
  slip: {
    column: 'email_slip',
    label: 'Slip gaji terbit',
    description: 'Slip gaji periode terbaru sudah bisa dilihat. Email hanya berisi pemberitahuan, tanpa nominal.',
    subject: 'Slip gaji sudah tersedia',
  },
  pengingat: {
    column: 'email_pengingat',
    label: 'Pengingat lupa clock-out',
    description: 'Pengingat bila kamu sudah absen masuk tetapi belum absen pulang setelah jam pulang terlewat.',
    subject: 'Pengingat: kamu belum absen pulang',
  },
};

export const EMAIL_CATEGORY_KEYS = Object.keys(EMAIL_CATEGORIES);

const TIPE_KE_KATEGORI = {
  // pengajuan masuk (ke penyetuju)
  cuti_diajukan: 'pengajuan',
  cuti_dibatalkan: 'pengajuan',
  lembur_diajukan: 'pengajuan',
  koreksi_absensi_diajukan: 'pengajuan',
  profil_diajukan: 'pengajuan',
  reimbursement_diajukan: 'pengajuan',
  // keputusan (ke pemilik pengajuan)
  cuti_approved: 'keputusan',
  cuti_rejected: 'keputusan',
  cuti_cancelled: 'keputusan',
  lembur_approved: 'keputusan',
  lembur_rejected: 'keputusan',
  koreksi_absensi_disetujui: 'keputusan',
  koreksi_absensi_ditolak: 'keputusan',
  absensi_dikoreksi: 'keputusan',
  profil_approved: 'keputusan',
  profil_rejected: 'keputusan',
  reimbursement_approved: 'keputusan',
  reimbursement_rejected: 'keputusan',
  reimbursement_paid: 'keputusan',
  // slip terbit
  payslip_published: 'slip',
  payroll_approved: 'slip',
  // pengingat
  lupa_clock_out: 'pengingat',
};

// Kunci kategori ('pengajuan' | 'keputusan' | 'slip' | 'pengingat') untuk satu
// nilai `tipe`, atau null kalau tipe itu tidak dikirimi email.
export function getEmailCategory(tipe) {
  if (typeof tipe !== 'string' || !Object.hasOwn(TIPE_KE_KATEGORI, tipe)) return null;
  return TIPE_KE_KATEGORI[tipe];
}
