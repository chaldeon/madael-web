import { getSessionEmployee } from '@/lib/sessionEmployee';

// SERVER ONLY — ambil baris employees_master MILIK AKUN YANG SEDANG LOGIN
// (linked_employee_id = id akun dari sesi), hanya dengan kolom yang diminta.
// Dipakai route /api/profile/* supaya pembacaan data pribadi tidak lagi
// langsung dari browser dan tidak bergantung pada RLS employees_master.
//
// admin   : client service role dari createAdminClient()
// columns : string kolom select; pemanggil bertanggung jawab membatasinya
// Return  : { master } (null kalau akun belum terhubung ke master),
//           atau { error, status } untuk dikirim sebagai JSON.
export async function getOwnMaster(admin, columns) {
  const session = await getSessionEmployee('id, status');
  if (session.error) return { error: session.error, status: session.status };

  const { data, error } = await admin
    .from('employees_master')
    .select(columns)
    .eq('linked_employee_id', session.emp.id)
    .maybeSingle();
  if (error) throw error;

  return { master: data || null };
}
