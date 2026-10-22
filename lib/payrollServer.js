import { periodeLabel } from '@/lib/payrollRunConfig';
import { friendlyError } from '@/lib/errorMessage';
import { todayJakarta } from '@/lib/serverTime';

// SERVER ONLY — dipakai API route payroll. `admin` WAJIB client service role
// (createAdminClient()).

// Kolom item run yang dibutuhkan untuk membuat slip + nama untuk pesan error.
export const RUN_ITEM_SELECT =
  '*, employees_master ( id, nama, posisi, linked_employee_id, nama_rekening, no_rekening, jkk_rate, status_ptkp )';

// Nomor dokumen slip (counter INV). Format sama dengan
// app/api/documents/generate-number/route.js (kode_jenis 'INV'); increment
// atomik lewat fungsi Postgres increment_document_counter.
async function generateNomorSlip(admin) {
  const { data: nomor, error } = await admin.rpc('increment_document_counter', { p_counter_kode: 'INV' });
  if (error) throw error;
  const [tahun] = todayJakarta().split('-');
  return `INV/${Number(tahun)}/${String(nomor).padStart(3, '0')}`;
}

function slipPayload(item, linkedId, periode) {
  return {
    employee_id: linkedId,
    periode,
    periode_label: periodeLabel(periode),
    gaji_pokok: item.gaji_pokok,
    tunjangan_lain: item.allowance,
    lembur: item.overtime,
    insentif: item.insentif,
    kompensasi: item.kompensasi,
    jht_karyawan: 0,
    jp_karyawan: 0,
    bpjs_k_karyawan: 0,
    pph21: item.pph21,
    penalty: item.penalty,
    is_published: true,
  };
}

// Buat/hubungkan slip Payslip Portal untuk tiap item run yang employee-nya
// sudah terhubung ke akun Absensi. IDEMPOTEN — aman dipanggil berulang:
//  - item yang sudah punya payslip_id dikenali dan tidak dibuatkan slip baru;
//  - kalau belum, dicari slip employee+periode yang sudah ada (mis. proses
//    sebelumnya terputus setelah insert tapi sebelum payslip_id tersimpan,
//    atau slip manual) lalu dihubungkan, bukan digandakan.
//
// overwriteExisting:
//   true  -> slip yang sudah ada ikut diperbarui dari snapshot run (perilaku
//            approve; sama seperti sebelumnya).
//   false -> slip yang sudah ada TIDAK disentuh (dipakai "Generate ulang
//            slip": hanya melengkapi yang belum ada, sehingga rincian BPJS
//            yang sudah dilengkapi manual di Kelola Slip Gaji tidak
//            tertimpa dan slip yang sengaja di-unpublish tidak terbit lagi).
//
// Item gagal tidak menghentikan item lain. Return:
// { created, updated, linked, skipped, errors[], createdEmployeeIds[] }
export async function generateSlipsForRun(admin, { periode, items, overwriteExisting }) {
  const result = { created: 0, updated: 0, linked: 0, skipped: 0, errors: [], createdEmployeeIds: [] };

  for (const item of items) {
    const linkedId = item.employees_master?.linked_employee_id;
    const nama = item.employees_master?.nama || 'Employee';
    if (!linkedId) { result.skipped += 1; continue; }

    try {
      let existingId = item.payslip_id || null;
      if (!existingId) {
        const { data: found, error: findError } = await admin
          .from('payslips')
          .select('id')
          .eq('employee_id', linkedId)
          .eq('periode', periode)
          .limit(1);
        if (findError) throw findError;
        existingId = found?.[0]?.id || null;
      }

      let slipId = existingId;
      if (existingId) {
        if (overwriteExisting) {
          const { error } = await admin.from('payslips').update(slipPayload(item, linkedId, periode)).eq('id', existingId);
          if (error) throw error;
          result.updated += 1;
        } else if (!item.payslip_id) {
          result.linked += 1;
        }
      } else {
        const nomorDokumen = await generateNomorSlip(admin);
        const { data: inserted, error } = await admin
          .from('payslips')
          .insert([{ ...slipPayload(item, linkedId, periode), nomor_dokumen: nomorDokumen }])
          .select('id')
          .single();
        if (error) throw error;
        slipId = inserted.id;
        result.created += 1;
        result.createdEmployeeIds.push(linkedId);
      }

      if (item.payslip_id !== slipId) {
        const { error } = await admin.from('payroll_run_items').update({ payslip_id: slipId }).eq('id', item.id);
        if (error) throw error;
      }
    } catch (err) {
      console.error('Generate slip payroll error:', err);
      result.errors.push(`${nama}: ${friendlyError(err, 'terjadi kesalahan.')}`);
    }
  }

  return result;
}

// Ringkasan hasil generate untuk ditampilkan di halaman.
export function ringkasanGenerateSlip(result) {
  const berhasil = result.created + result.updated;
  let note = `${berhasil} slip berhasil dibuat/diperbarui.`;
  if (result.linked > 0) note += ` ${result.linked} slip yang sudah ada dihubungkan ke run ini.`;
  if (result.skipped > 0) note += ` ${result.skipped} employee dilewati (belum terhubung ke akun Absensi).`;
  if (result.errors.length > 0) note += ` Error: ${result.errors.join('; ')}`;
  return note;
}
