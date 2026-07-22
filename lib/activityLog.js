// Helper activity log — audit trail untuk aksi-aksi penting (koreksi absensi,
// approve/reject cuti, ubah status payroll, edit struktur gaji employee).
// Sama seperti notify.js, ini "fire and forget": gagal mencatat log tidak
// boleh membatalkan aksi utama yang sudah tersimpan.
//
// aksi        : deskripsi singkat aksi, mis. 'koreksi_absensi', 'approve_cuti'
// targetTable : nama tabel yang kena dampak, mis. 'attendance', 'leave_requests'
// targetId    : id row yang kena dampak
// detail      : object bebas (before/after, catatan) — disimpan sebagai jsonb
export async function logActivity(supabase, { userId, aksi, targetTable = null, targetId = null, detail = null }) {
  try {
    await supabase.from('activity_logs').insert([{
      user_id: userId,
      aksi,
      target_table: targetTable,
      target_id: targetId,
      detail,
    }]);
  } catch (err) {
    console.error('Gagal mencatat activity log:', err);
  }
}
