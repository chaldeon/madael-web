import { requireModuleAccess } from '@/lib/moduleAccessServer';

// SERVER ONLY — gate untuk route kelola lokasi kerja (geofence absensi).
// Sama dengan tab "Lokasi Kerja" dan route QR: khusus superadmin yang juga
// punya akses modul absensi_admin. Return { emp } atau { error, status }.
export async function requireLokasiAdmin(admin) {
  const access = await requireModuleAccess(admin, ['absensi_admin']);
  if (access.error) return access;
  if (!access.emp.is_superadmin) {
    return { error: 'Hanya superadmin yang boleh mengelola lokasi kerja.', status: 403 };
  }
  return { emp: access.emp };
}
