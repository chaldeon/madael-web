// SERVER ONLY — daftar aksi yang boleh dicatat dari browser lewat
// /api/activity-log. Aksi di luar daftar ini ditolak, jadi pengguna tidak bisa
// menulis jenis log sembarang. Tiap aksi terikat ke SATU tabel target dan ke
// modul yang memang berwenang melakukannya (superadmin lolos kecuali modul
// EXPLICIT_ONLY, lihat isModuleGranted).
//
// Log untuk aksi yang mutasinya terjadi di server (API route) tidak lewat sini;
// route itu menulis langsung dengan lib/activityLog.js.
// Aksi baru yang masih dicatat dari browser harus didaftarkan di sini dulu.

const PERATURAN = ['peraturan_ketenagakerjaan'];
const PAYROLL = ['payroll'];
const PENGUMUMAN = ['announcements_admin'];
const JOB_PORTAL = ['job_portal', 'job_portal_assigned'];

export const CLIENT_LOG_POLICY = {
  // Peraturan Ketenagakerjaan
  ekspor_peraturan: { table: 'peraturan', needs: PERATURAN },
  tambah_peraturan: { table: 'peraturan', needs: PERATURAN },
  ubah_peraturan: { table: 'peraturan', needs: PERATURAN },
  hapus_peraturan: { table: 'peraturan', needs: PERATURAN },
  impor_peraturan_massal: { table: 'peraturan', needs: PERATURAN },
  pulihkan_revisi_peraturan: { table: 'peraturan', needs: PERATURAN },
  tambah_pasal_peraturan: { table: 'peraturan_pasal', needs: PERATURAN },
  ubah_pasal_peraturan: { table: 'peraturan_pasal', needs: PERATURAN },
  hapus_pasal_peraturan: { table: 'peraturan_pasal', needs: PERATURAN },
  pulihkan_revisi_pasal: { table: 'peraturan_pasal', needs: PERATURAN },
  tambah_relasi_peraturan: { table: 'peraturan_relasi', needs: PERATURAN },
  hapus_relasi_peraturan: { table: 'peraturan_relasi', needs: PERATURAN },

  // Payroll & Payslip
  edit_struktur_gaji: { table: 'employees_master', needs: PAYROLL },
  tambah_employee_master: { table: 'employees_master', needs: PAYROLL },
  ekspor_slip_gaji: { table: 'payslips', needs: ['payslip_admin'] },

  // Reimbursement
  ekspor_reimbursement: { table: 'reimbursement_requests', needs: ['reimbursement_admin'] },

  // Pengumuman
  buat_pengumuman: { table: 'announcements', needs: PENGUMUMAN },
  edit_pengumuman: { table: 'announcements', needs: PENGUMUMAN },
  nonaktifkan_pengumuman: { table: 'announcements', needs: PENGUMUMAN },
  hapus_pengumuman: { table: 'announcements', needs: PENGUMUMAN },

  // Job Portal (reviewer terbatas ikut lolos; mutasi lowongan sendiri tetap
  // dijaga RLS tabel job_listings)
  buat_lowongan: { table: 'job_listings', needs: JOB_PORTAL },
  ubah_lowongan: { table: 'job_listings', needs: JOB_PORTAL },
  ubah_status_lowongan: { table: 'job_listings', needs: JOB_PORTAL },
  duplikat_lowongan: { table: 'job_listings', needs: JOB_PORTAL },
};

export const MAKS_DETAIL_BYTES = 8 * 1024;
