import { fetchAllRows } from '@/lib/fetchAllRows';
import { computeSnapshot } from '@/lib/payroll/runSnapshot';

// SERVER ONLY — dipakai API route pembuatan/sinkronisasi Payroll Run. `admin`
// WAJIB client service role (createAdminClient()).

export const PERIODE_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

// Validasi bentuk id dari URL/body tanpa mengasumsikan tipe kolomnya (skema DB
// tidak ada di repo): string pendek berisi huruf/angka/-/_. Id yang formatnya
// salah untuk kolom akan ditolak Postgres (22P02) dan dijawab 404/400.
export function idBentukValid(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

// Kolom employees_master yang dibutuhkan computeSnapshot.
const MASTER_SNAPSHOT_SELECT =
  'id, gaji_pokok, tunjangan, komponen_lain, linked_employee_id, status_ptkp, jkk_rate';

// Semua employees_master milik satu klien (dipaginasi supaya tidak terpotong
// di 1.000 baris).
export async function loadMastersByClient(admin, clientId) {
  return fetchAllRows(() =>
    admin.from('employees_master').select(MASTER_SNAPSHOT_SELECT).eq('client_id', clientId)
  );
}

// Pisahkan master yang akun absensinya (employees.status) Nonaktif. Karyawan
// yang resign/dinonaktifkan tidak ikut run. Return { aktif, dilewati } dengan
// dilewati = [{ master, nama }], atau { error }.
export async function pisahAkunNonaktif(admin, masters) {
  const linkedIds = [...new Set(masters.map((m) => m.linked_employee_id).filter(Boolean))];
  const nonaktifById = new Map();

  // Dipecah per 100 id agar URL query tidak kepanjangan.
  for (let i = 0; i < linkedIds.length; i += 100) {
    const chunk = linkedIds.slice(i, i + 100);
    const { data, error } = await admin.from('employees').select('id, nama, status').in('id', chunk);
    if (error) return { error };
    (data || []).forEach((acc) => {
      if (acc.status === 'Nonaktif') nonaktifById.set(acc.id, acc.nama);
    });
  }

  const aktif = [];
  const dilewati = [];
  masters.forEach((m) => {
    if (m.linked_employee_id && nonaktifById.has(m.linked_employee_id)) {
      dilewati.push({ master: m, nama: nonaktifById.get(m.linked_employee_id) });
    } else {
      aktif.push(m);
    }
  });
  return { aktif, dilewati };
}

// Hitung snapshot untuk banyak master. Dibatasi 10 paralel supaya klien dengan
// ratusan karyawan tidak menembak ratusan query sekaligus.
export async function buildSnapshots(admin, masters, periode, concurrency = 10) {
  const out = [];
  for (let i = 0; i < masters.length; i += concurrency) {
    const chunk = masters.slice(i, i + concurrency);
    const part = await Promise.all(chunk.map((m) => computeSnapshot(admin, m, periode)));
    out.push(...part);
  }
  return out;
}
