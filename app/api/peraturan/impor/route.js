import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logActivity } from '@/lib/activityLog';
import { friendlyError } from '@/lib/errorMessage';
import { IMPORT_LIMITS } from '@/lib/peraturanConfig';
import { gerbangTulisPeraturan, jsonError, bacaPayloadImpor } from '@/lib/peraturanServer';

// Kode error yang membuat sisa impor tidak ada gunanya dilanjutkan (tidak punya
// izin, sesi habis, atau koneksi ke database putus -> error tanpa kode).
function fatal(err) {
  return !err?.code || ['42501', 'PGRST301', 'PGRST303'].includes(String(err.code));
}

// POST /api/peraturan/impor
//   body: { nama_file, batch_ke, batch_total, total_baris,
//           items: [{ rowNo, payload }]  (maks. IMPORT_LIMITS.batchSize) }
//   -> { berhasil, dilewati, gagal: [{ rowNo, pesan }], berhenti }
//
// Impor massal bersifat add-only: baris yang sudah ada (unique jenis + nomor +
// tahun) dilewati, tidak pernah ditimpa. Browser mengirim file per batch; tiap
// baris divalidasi ulang di sini. Satu batch = satu entri Activity Log (bukan
// per baris) supaya log tidak banjir.
//
// Batch dimasukkan dalam SATU insert; kalau ditolak seluruhnya (mis. ada
// duplikat), diulang per baris untuk memisahkan duplikat dari baris yang benar-
// benar gagal — perilaku yang sama dengan sebelumnya.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const g = await gerbangTulisPeraturan(admin);
    if (g.response) return g.response;
    const { emp, db } = g;

    const body = await request.json().catch(() => ({}));
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0 || items.length > IMPORT_LIMITS.batchSize) {
      return jsonError(`Satu permintaan impor harus berisi 1 sampai ${IMPORT_LIMITS.batchSize} baris.`, 400);
    }

    const siap = [];
    const gagal = [];
    for (const item of items) {
      const rowNo = Number(item?.rowNo);
      if (!Number.isInteger(rowNo) || rowNo < 1) return jsonError('Nomor baris impor tidak valid.', 400);
      const parsed = bacaPayloadImpor(item.payload);
      if (parsed.error) gagal.push({ rowNo, pesan: parsed.error });
      else siap.push({ rowNo, payload: parsed.payload });
    }

    let berhasil = 0;
    let dilewati = 0;
    let berhenti = false;

    if (siap.length > 0) {
      const { error: batchError } = await db.from('peraturan').insert(siap.map((r) => r.payload));
      if (!batchError) {
        berhasil = siap.length;
      } else {
        for (const r of siap) {
          if (berhenti) {
            gagal.push({ rowNo: r.rowNo, pesan: 'Tidak diproses karena impor dihentikan (izin, sesi, atau koneksi bermasalah).' });
            continue;
          }
          const { error: rowError } = await db.from('peraturan').insert([r.payload]);
          if (!rowError) {
            berhasil += 1;
          } else if (rowError.code === '23505') {
            dilewati += 1;
          } else {
            gagal.push({
              rowNo: r.rowNo,
              pesan: friendlyError(rowError, 'Gagal menyimpan baris ini.', { context: 'Impor peraturan' }),
            });
            if (fatal(rowError)) berhenti = true;
          }
        }
      }

      const namaFile = typeof body.nama_file === 'string' ? body.nama_file.slice(0, 200) : null;
      const angka = (v) => (Number.isInteger(v) && v > 0 ? v : null);
      await logActivity(admin, {
        userId: emp.id,
        aksi: 'impor_peraturan_massal',
        targetTable: 'peraturan',
        targetId: null,
        detail: {
          nama_file: namaFile,
          batch: angka(body.batch_ke) && angka(body.batch_total) ? `${body.batch_ke}/${body.batch_total}` : null,
          total_baris_file: angka(body.total_baris),
          baris_batch: items.length,
          berhasil,
          dilewati,
          gagal: gagal.length,
        },
      });
    }

    gagal.sort((a, b) => a.rowNo - b.rowNo);
    return NextResponse.json({ berhasil, dilewati, gagal, berhenti });
  } catch (err) {
    console.error('Impor peraturan:', err);
    return jsonError('Gagal memproses impor peraturan.', 500);
  }
}
