import { fetchAllRows } from '@/lib/fetchAllRows';
import { idBentukValid } from '@/lib/payrollRunServer';

// SERVER ONLY — loader sumber Tool BPA1 (Bukti Potong A1 tahunan per klien).
// Membaca 12 Payroll Run bulanan (Jan–Des) satu klien beserta item run-nya.
//
// READ-ONLY: tidak menulis ke tabel apa pun dan tidak mengubah perilaku
// Payroll Run / Payslip / Payroll Manager. Tidak ada kalkulasi pajak di sini —
// angka yang dikembalikan adalah snapshot yang sudah tersimpan di item run.
//
// OTORISASI BUKAN TUGAS FILE INI. `admin` WAJIB client service role
// (createAdminClient()) sehingga RLS tidak berlaku; pemanggil (API route BPA1)
// harus lebih dulu lolos requireBpa1Access(admin) dari lib/moduleAccessServer.js.
//
// ASUMSI (belum divalidasi — skema DB tidak ada di repo, nama kolom disimpulkan
// dari kode: app/api/payroll/runs/route.js, lib/payroll/runSnapshot.js):
//  - payroll_runs: id, client_id, periode ('YYYY-MM', teks), status
//  - payroll_run_items: id, payroll_run_id, employee_master_id, gaji_pokok,
//    allowance, overtime, insentif, kompensasi, penalty, bpjs_employer,
//    bpjs_employee, pph21, take_home_pay, incomplete
//  - Sumber kerja = Payroll Run (Usulan; keputusan K-06 "Payroll Run vs payslip"
//    belum diputuskan). Karena itu sumber dibungkus adapter (`sumberPayrollRun`)
//    dan `loadBpa1Sumber` menerima adapter lain lewat opsi `sumber`, supaya
//    bila K-06 memilih payslip cukup menulis adapter baru dengan bentuk yang
//    sama, tanpa mengubah pemanggil.
//
// Bentuk kembalian mengikuti fetchAllRows: `{ data, error }`; pada error `data`
// bernilai null. Error masukan/data memakai `{ code, message }`.

export const BPA1_INPUT_TIDAK_VALID = 'BPA1_INPUT_TIDAK_VALID';
export const BPA1_RUN_GANDA = 'BPA1_RUN_GANDA';
export const KETERANGAN_TIDAK_ADA_RUN = 'tidak ada run';

// Batas wajar tahun pajak; mencegah masukan salah ketik (mis. 20266).
export const TAHUN_MIN = 2000;
export const TAHUN_MAX = 2100;

// Kolom run & item yang dibaca — sengaja minimal. TIDAK memakai RUN_ITEM_SELECT
// dari lib/payrollServer.js (itu memuat nama/no rekening). Tidak ada NPWP/NIK/
// rekening dan tidak ada join ke employees_master. Item hanya membawa
// employee_master_id; data identitas diambil pemanggil lewat jalur terpisah
// bila memang dibutuhkan (BPA berikutnya).
const RUN_SELECT = 'id, client_id, periode, status';
const RUN_ITEM_SELECT =
  'id, payroll_run_id, employee_master_id, gaji_pokok, allowance, overtime, insentif, kompensasi, penalty, bpjs_employer, bpjs_employee, pph21, take_home_pay, incomplete';

// Terima angka atau string 4 digit ('2026'). Return angka tahun, atau null.
export function bacaTahun(raw) {
  let n = NaN;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\d{4}$/.test(raw.trim())) n = Number(raw.trim());
  return Number.isInteger(n) && n >= TAHUN_MIN && n <= TAHUN_MAX ? n : null;
}

// ['2026-01', ..., '2026-12']
export function daftarPeriodeTahun(tahun) {
  return Array.from({ length: 12 }, (_, i) => `${tahun}-${String(i + 1).padStart(2, '0')}`);
}

function errorInput(message) {
  return { data: null, error: { code: BPA1_INPUT_TIDAK_VALID, message } };
}

// Adapter sumber: Payroll Run bulanan.
// muat(admin, clientId, daftarPeriode) -> { data: Map<periode, { run, items }>, error }
// Hanya periode yang PUNYA run yang ada di Map. Status run (Draft/Review/
// Approved) dikembalikan apa adanya, TIDAK difilter — keputusan status mana
// yang dianggap final ada di pemanggil.
export const sumberPayrollRun = {
  nama: 'payroll_run',

  async muat(admin, clientId, daftarPeriode) {
    const runsRes = await fetchAllRows(() =>
      admin
        .from('payroll_runs')
        .select(RUN_SELECT)
        .eq('client_id', clientId)
        .in('periode', daftarPeriode)
    );
    if (runsRes.error) return { data: null, error: runsRes.error };

    // Aturan bisnis: satu run per klien+periode. Penegakan di level DB butuh
    // migrasi yang belum tentu sudah terpasang, jadi dicek di sini. Kalau ada
    // dobel, jangan menebak mana yang benar — kembalikan error.
    const runByPeriode = new Map();
    for (const run of runsRes.data) {
      if (runByPeriode.has(run.periode)) {
        return {
          data: null,
          error: {
            code: BPA1_RUN_GANDA,
            message: `Ditemukan lebih dari satu Payroll Run untuk periode ${run.periode}.`,
          },
        };
      }
      runByPeriode.set(run.periode, run);
    }

    const itemsByRunId = new Map();
    for (const run of runByPeriode.values()) itemsByRunId.set(run.id, []);

    if (itemsByRunId.size > 0) {
      const runIds = [...itemsByRunId.keys()];
      const itemsRes = await fetchAllRows(() =>
        admin.from('payroll_run_items').select(RUN_ITEM_SELECT).in('payroll_run_id', runIds)
      );
      if (itemsRes.error) return { data: null, error: itemsRes.error };

      for (const row of itemsRes.data) {
        const { payroll_run_id: runId, ...item } = row;
        itemsByRunId.get(runId)?.push(item);
      }
    }

    const hasil = new Map();
    for (const [periode, run] of runByPeriode) {
      hasil.set(periode, {
        run: { id: run.id, status: run.status },
        items: itemsByRunId.get(run.id),
      });
    }
    return { data: hasil, error: null };
  },
};

// Muat 12 bulan (Jan–Des) sumber BPA1 untuk satu klien dan satu tahun.
//
// Return { data, error } dengan data =
//   {
//     sumber: 'payroll_run', clientId, tahun,
//     bulan: [ // selalu 12 entri, urut Jan..Des
//       { periode: '2026-01', bulan: 1, adaRun: true,
//         run: { id, status }, items: [ ...baris item ], keterangan: null },
//       { periode: '2026-02', bulan: 2, adaRun: false,
//         run: null, items: null, keterangan: 'tidak ada run' },
//       ...
//     ],
//   }
//
// Bulan tanpa run ditandai eksplisit (`adaRun: false`, `run`/`items` = null,
// keterangan 'tidak ada run') — BUKAN diisi nol, supaya tidak tertukar dengan
// bulan yang punya run tetapi item-nya kosong (`items: []`).
export async function loadBpa1Sumber(admin, clientId, tahun, { sumber = sumberPayrollRun } = {}) {
  if (!idBentukValid(clientId)) return errorInput('Klien tidak valid.');
  const tahunValid = bacaTahun(tahun);
  if (tahunValid === null) {
    return errorInput(`Tahun tidak valid (harus 4 digit antara ${TAHUN_MIN}–${TAHUN_MAX}).`);
  }

  const daftarPeriode = daftarPeriodeTahun(tahunValid);
  const { data: hasil, error } = await sumber.muat(admin, clientId, daftarPeriode);
  if (error) return { data: null, error };

  const bulan = daftarPeriode.map((periode, i) => {
    const ada = hasil.get(periode);
    if (!ada) {
      return {
        periode,
        bulan: i + 1,
        adaRun: false,
        run: null,
        items: null,
        keterangan: KETERANGAN_TIDAK_ADA_RUN,
      };
    }
    return { periode, bulan: i + 1, adaRun: true, run: ada.run, items: ada.items, keterangan: null };
  });

  return { data: { sumber: sumber.nama, clientId, tahun: tahunValid, bulan }, error: null };
}
