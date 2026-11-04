import { requireModuleAccess } from '@/lib/moduleAccessServer';
import { isModuleGranted } from '@/lib/employeeModules';
import { friendlyError } from '@/lib/errorMessage';

// SERVER ONLY — gate bersama untuk mengubah dokumen (status & isi). Aturan
// SAMA dengan yang dulu dipasang di halaman (app/employee/documents/[id]):
// pemegang modul Documents (document_generator / nomor_surat) yang juga
// superadmin, pembuat dokumen, atau pemegang sub-modul document_manage.
//
// Return { emp, doc } kalau lolos, atau { error, status } untuk dikirim JSON.
export async function muatDokumenUntukKelola(admin, id, selectColumns) {
  const access = await requireModuleAccess(admin, ['document_generator', 'nomor_surat']);
  if (access.error) return { error: access.error, status: access.status };
  const { emp } = access;

  const { data: doc, error: docError } = await admin
    .from('documents')
    .select(selectColumns)
    .eq('id', id)
    .maybeSingle();
  // 22P02 = id bukan format yang valid -> sama dengan "tidak ditemukan"
  if (docError && docError.code !== '22P02') {
    return {
      error: `Gagal memuat dokumen: ${friendlyError(docError, 'terjadi kesalahan pada server.', { context: 'Muat dokumen untuk diubah' })}`,
      status: 500,
    };
  }
  if (docError || !doc) return { error: 'Dokumen tidak ditemukan.', status: 404 };

  let boleh = !!emp.is_superadmin || doc.created_by === emp.id;
  if (!boleh) {
    const { data: mods, error: modError } = await admin
      .from('employee_modules')
      .select('module_name')
      .eq('employee_id', emp.id)
      .eq('module_name', 'document_manage');
    if (modError) throw modError;
    boleh = isModuleGranted({
      isSuperadmin: false,
      moduleKeys: (mods || []).map((m) => m.module_name),
      key: 'document_manage',
    });
  }
  if (!boleh) {
    return { error: 'Kamu tidak berhak mengubah dokumen ini.', status: 403 };
  }

  return { emp, doc };
}
