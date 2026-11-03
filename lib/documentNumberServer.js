import { todayJakarta } from '@/lib/serverTime';

// SERVER ONLY — satu-satunya tempat aturan nomor surat/invoice dan pengambilan
// nomor dari counter. `admin` WAJIB client service role (createAdminClient()).
//
// Dulu Documents mengambil nomor lewat /api/documents/generate-number lalu
// meng-insert dokumen dari browser: kalau insert gagal, nomor sudah terpakai
// dan hangus. Sekarang pengambilan nomor + insert dilakukan di satu route
// server (POST /api/documents, POST /api/invoices), dan nomor dikembalikan ke
// counter bila insert gagal (pola yang sama dengan slip gaji di payslipServer).

// Jenis dokumen -> label kode di nomor surat + counter yang dipakai.
export const DOKUMEN_JENIS = {
  PRO:    { label: 'MKT', counter: 'GLOBAL' },
  QUO:    { label: 'MKT', counter: 'GLOBAL' },
  PROQUO: { label: 'MKT', counter: 'GLOBAL' },
  AGR:    { label: 'ADM', counter: 'GLOBAL' },
  ADM:    { label: 'ADM', counter: 'GLOBAL' },
  INV:    { label: 'INV', counter: 'INV' },
};

// Counter yang aktif dipakai (sama dengan ACTIVE_COUNTER_KODE di halaman
// Nomor Surat). Counter lain adalah arsip dan tidak boleh diubah.
export const COUNTER_AKTIF = ['GLOBAL', 'INV'];

const ROMAWI_BULAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// Pola nomor otomatis invoice: INV/2026/003
export const POLA_NOMOR_INVOICE = /^INV\/(\d{4})\/(\d{3,})$/;

// Susun nomor dari urutan counter. Bulan & tahun memakai waktu Jakarta (server
// berjalan di UTC, jadi getMonth()/getFullYear() salah pada 00:00-06:59 WIB
// tanggal 1).
export function formatNomorDokumen(kodeJenis, urutan) {
  const config = DOKUMEN_JENIS[kodeJenis];
  if (!config) throw new Error(`Jenis dokumen tidak dikenal: ${kodeJenis}`);
  const [tahun, bulan] = todayJakarta().split('-');
  const padded = String(urutan).padStart(3, '0');
  if (kodeJenis === 'INV') return `${config.label}/${Number(tahun)}/${padded}`;
  return `${padded}/${config.label}/MPSI/${ROMAWI_BULAN[Number(bulan) - 1]}-${Number(tahun)}`;
}

// Ambil nomor berikutnya (increment atomik lewat fungsi Postgres
// increment_document_counter). Return { urutan, counter, nomor }. Melempar
// error kalau RPC gagal.
export async function ambilNomorDokumen(admin, kodeJenis) {
  const config = DOKUMEN_JENIS[kodeJenis];
  if (!config) throw new Error(`Jenis dokumen tidak dikenal: ${kodeJenis}`);
  const { data: urutan, error } = await admin.rpc('increment_document_counter', {
    p_counter_kode: config.counter,
  });
  if (error) throw error;
  return { urutan, counter: config.counter, nomor: formatNomorDokumen(kodeJenis, urutan) };
}

// Kembalikan nomor yang diambil tetapi tidak jadi dipakai (insert gagal).
// Counter hanya diturunkan kalau nilainya MASIH sama dengan nomor tersebut —
// artinya belum ada pihak lain yang mengambil nomor sesudahnya, jadi tidak
// mungkin menghasilkan nomor ganda. Kalau sudah ada, nomor dibiarkan sebagai
// celah (aman). Best effort: tidak pernah melempar. Return true kalau berhasil
// dikembalikan.
export async function kembalikanNomorDokumen(admin, counterKode, urutan) {
  try {
    const n = Number(urutan);
    if (!Number.isInteger(n) || n < 1) return false;
    const { data, error } = await admin
      .from('document_counters')
      .update({ last_number: n - 1 })
      .eq('kode', counterKode)
      .eq('last_number', n)
      .select('id');
    if (error) {
      console.error('Gagal mengembalikan nomor dokumen:', error);
      return false;
    }
    return (data || []).length > 0;
  } catch (err) {
    console.error('Gagal mengembalikan nomor dokumen:', err);
    return false;
  }
}

// Batas wajar nilai counter (koreksi manual).
export const MAX_COUNTER = 9_999_999;

// Validasi body koreksi counter. Return { values } atau { error }.
export function validateKoreksiCounter(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Data koreksi tidak valid.' };
  }
  const baru = body.last_number;
  const harapan = body.expected_last_number;
  const valid = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_COUNTER;
  if (!valid(baru)) {
    return { error: `Nomor terakhir harus berupa bilangan bulat 0 sampai ${MAX_COUNTER}.` };
  }
  if (!valid(harapan)) {
    return { error: 'Data counter tidak lengkap. Muat ulang halaman lalu coba lagi.' };
  }
  return {
    values: { last_number: baru, expected_last_number: harapan, konfirmasi_turun: body.konfirmasi_turun === true },
  };
}
