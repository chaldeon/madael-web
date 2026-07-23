// Helper notifikasi in-app. Dipanggil langsung dari client component setelah
// sebuah aksi berhasil (submit cuti, approve/reject, payroll approve, dst).
// Sengaja "fire and forget" dengan try/catch — kalau insert notifikasi gagal,
// jangan sampai membatalkan/mengganggu aksi utama yang sudah berhasil disimpan.

// Kirim notifikasi ke satu employee tertentu (employees.id).
export async function notifyEmployee(supabase, { userId, tipe, pesan, link = null }) {
  if (!userId) return;
  try {
    await supabase.from('notifications').insert([{ user_id: userId, tipe, pesan, link }]);
  } catch (err) {
    console.error('Gagal mengirim notifikasi:', err);
  }
}

// Kirim notifikasi ke beberapa employee sekaligus (mis. semua yang punya
// payslip di satu payroll run).
export async function notifyEmployees(supabase, { userIds, tipe, pesan, link = null }) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  if (ids.length === 0) return;
  try {
    await supabase.from('notifications').insert(
      ids.map((id) => ({ user_id: id, tipe, pesan, link }))
    );
  } catch (err) {
    console.error('Gagal mengirim notifikasi massal:', err);
  }
}

// Kirim notifikasi ke semua superadmin — dipakai untuk "cuti diajukan (ke
// admin)" karena tidak ada satu akun admin tunggal di sistem ini.
export async function notifySuperadmins(supabase, { tipe, pesan, link = null }) {
  try {
    const { data: admins } = await supabase
      .from('employees')
      .select('id')
      .eq('is_superadmin', true);

    await notifyEmployees(supabase, {
      userIds: (admins || []).map((a) => a.id),
      tipe,
      pesan,
      link,
    });
  } catch (err) {
    console.error('Gagal mengirim notifikasi ke superadmin:', err);
  }
}
