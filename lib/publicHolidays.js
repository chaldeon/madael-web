// Hari libur nasional & cuti bersama (tabel public_holidays). Fungsi murni
// (aman dipakai di server maupun browser) plus satu pemuat yang menerima client
// Supabase apa pun: service role di route server, atau client browser (tabel
// ini boleh dibaca semua pengguna login, lihat migrasi
// supabase/migrations/20261104120000_hari_libur_nasional.sql).
//
// Aturan yang dipakai bersama oleh cuti (lib/leave.js), rekap absensi
// (lib/attendanceSummary.js), monitor kehadiran (lib/kehadiranHariIni.js), dan
// jenis hari lembur (lib/overtimeRules.js):
//   - Tanggal yang ada di tabel dianggap BUKAN hari kerja, kecuali jadwal
//     karyawan menandai `bekerja_di_hari_libur` (shift/outsourcing yang tetap
//     masuk di tanggal merah).
//   - Forward-only: data lama tidak dihitung ulang (lihat hariCutiBaris di
//     lib/leave.js).

export const JENIS_LIBUR = {
  nasional: { label: 'Libur Nasional' },
  cuti_bersama: { label: 'Cuti Bersama' },
};
export const JENIS_LIBUR_LIST = Object.keys(JENIS_LIBUR);
export const MAKS_NAMA_LIBUR = 120;
export const MAKS_BARIS_IMPOR_LIBUR = 100;

// Jenis libur yang dianggap bukan hari kerja. Ubah di sini kalau kebijakan
// perusahaan berbeda (mis. cuti bersama tetap hari kerja dan memotong kuota:
// cukup hapus 'cuti_bersama' dari daftar ini).
export const JENIS_LIBUR_BUKAN_HARI_KERJA = ['nasional', 'cuti_bersama'];

export function jenisLiburValid(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(JENIS_LIBUR, value);
}

export function labelJenisLibur(value) {
  return (JENIS_LIBUR[value] || JENIS_LIBUR.nasional).label;
}

// Validasi 'YYYY-MM-DD' (format dan tanggalnya benar-benar ada).
export function tanggalLiburValid(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Tahun yang boleh diisi: cukup lebar untuk perencanaan, cukup sempit untuk
// menangkap salah ketik (mis. 2062).
export const TAHUN_LIBUR_MIN = 2020;
export const TAHUN_LIBUR_MAX = 2100;

export function tahunLiburWajar(tanggal) {
  const tahun = Number(String(tanggal).slice(0, 4));
  return tahun >= TAHUN_LIBUR_MIN && tahun <= TAHUN_LIBUR_MAX;
}

// Baris tabel -> Map tanggal -> { nama, jenis }. Hanya jenis yang dianggap
// bukan hari kerja (JENIS_LIBUR_BUKAN_HARI_KERJA) yang masuk.
export function petaLibur(rows) {
  const map = new Map();
  (rows || []).forEach((r) => {
    if (!r?.tanggal || !JENIS_LIBUR_BUKAN_HARI_KERJA.includes(r.jenis)) return;
    map.set(String(r.tanggal).slice(0, 10), { nama: r.nama, jenis: r.jenis });
  });
  return map;
}

const KOSONG = new Map();

// Peta libur yang berlaku untuk SATU karyawan: kosong kalau jadwalnya
// menandai bekerja di hari libur. `jadwal` boleh null (belum ada jadwal).
export function liburUntukJadwal(libur, jadwal) {
  if (!libur) return KOSONG;
  return jadwal?.bekerja_di_hari_libur === true ? KOSONG : libur;
}

export function adalahLibur(libur, tanggal) {
  return !!libur && typeof libur.has === 'function' && libur.has(tanggal);
}

// Error "tabel belum ada" (migrasi belum dijalankan di Supabase): Postgres
// 42P01 atau PostgREST PGRST205 (tabel tidak ada di schema cache). Dalam kasus
// ini fitur libur dianggap kosong supaya alur yang sudah berjalan (cuti,
// absensi, lembur) tidak ikut terhenti sebelum migrasi diterapkan.
export function tabelLiburBelumAda(error) {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /public_holidays/i.test(String(error.message || '')) && /(does not exist|schema cache)/i.test(String(error.message || ''));
}

// Ambil libur pada rentang tanggal (inklusif). `client` = client Supabase mana
// pun. Return { error, libur: Map, rows, tabelAda }.
//   - tabel belum ada      -> { error: null, libur: kosong, tabelAda: false }
//   - error lain (jaringan) -> { error, libur: kosong, tabelAda: true }; pemanggil
//     yang menghitung kuota sebaiknya menghentikan prosesnya, bukan diam-diam
//     menghitung tanpa libur.
export async function ambilLibur(client, { dari, sampai }) {
  let q = client
    .from('public_holidays')
    .select('id, tanggal, nama, jenis')
    .order('tanggal', { ascending: true });
  if (dari) q = q.gte('tanggal', dari);
  if (sampai) q = q.lte('tanggal', sampai);
  const { data, error } = await q;
  if (error) {
    if (tabelLiburBelumAda(error)) return { error: null, libur: new Map(), rows: [], tabelAda: false };
    return { error, libur: new Map(), rows: [], tabelAda: true };
  }
  return { error: null, libur: petaLibur(data), rows: data || [], tabelAda: true };
}

// Batas satu bulan 'YYYY-MM' untuk query libur (tanpa Date lokal).
export function batasBulanLibur(monthValue) {
  const [tahun, bulan] = monthValue.split('-').map(Number);
  const hariTerakhir = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  return { dari: `${monthValue}-01`, sampai: `${monthValue}-${String(hariTerakhir).padStart(2, '0')}` };
}

// Parser impor satu tahun sekaligus. Tiap baris: `YYYY-MM-DD; Nama; jenis`
// (pemisah titik koma, koma, atau tab; jenis opsional, default nasional,
// menerima 'nasional' / 'cuti bersama' / 'cuti_bersama' / 'cb'). Baris kosong
// dan baris diawali # diabaikan. Tidak ada tanggal yang diisi otomatis dari
// memori: daftar resmi harus dari SKB 3 Menteri tahun yang bersangkutan.
// Return { items: [{ tanggal, nama, jenis, baris }], errors: [{ baris, pesan }] }.
export function parseImporLibur(teks) {
  const items = [];
  const errors = [];
  const seen = new Map();
  const lines = String(teks || '').split(/\r?\n/);

  lines.forEach((mentah, idx) => {
    const baris = idx + 1;
    const line = mentah.trim();
    if (!line || line.startsWith('#')) return;

    const bagian = line.split(/\t|;|,/).map((s) => s.trim());
    // "2026-12-25, Hari Raya Natal, nasional" — nama boleh mengandung koma kalau
    // pemisah tab/titik koma dipakai; di sini cukup ambil bagian pertama,
    // terakhir (jika jenis dikenal), dan sisanya sebagai nama.
    const tanggal = bagian[0];
    let jenis = 'nasional';
    let namaBagian = bagian.slice(1);
    if (namaBagian.length > 1) {
      const kandidat = normalisasiJenisLibur(namaBagian[namaBagian.length - 1]);
      if (kandidat) {
        jenis = kandidat;
        namaBagian = namaBagian.slice(0, -1);
      }
    }
    const nama = namaBagian.join(', ').trim();

    if (!tanggalLiburValid(tanggal)) {
      errors.push({ baris, pesan: `Tanggal "${tanggal}" tidak valid (format YYYY-MM-DD).` });
      return;
    }
    if (!tahunLiburWajar(tanggal)) {
      errors.push({ baris, pesan: `Tahun ${tanggal.slice(0, 4)} di luar rentang ${TAHUN_LIBUR_MIN}–${TAHUN_LIBUR_MAX}.` });
      return;
    }
    if (!nama) {
      errors.push({ baris, pesan: `Nama libur untuk ${tanggal} kosong.` });
      return;
    }
    if (nama.length > MAKS_NAMA_LIBUR) {
      errors.push({ baris, pesan: `Nama libur maksimal ${MAKS_NAMA_LIBUR} karakter.` });
      return;
    }
    if (seen.has(tanggal)) {
      errors.push({ baris, pesan: `Tanggal ${tanggal} dobel (sudah ada di baris ${seen.get(tanggal)}).` });
      return;
    }
    seen.set(tanggal, baris);
    items.push({ tanggal, nama, jenis, baris });
  });

  if (items.length + errors.length > MAKS_BARIS_IMPOR_LIBUR) {
    return { items: [], errors: [{ baris: 0, pesan: `Maksimal ${MAKS_BARIS_IMPOR_LIBUR} baris per impor.` }] };
  }
  return { items, errors };
}

function normalisasiJenisLibur(value) {
  const v = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (v === 'nasional') return 'nasional';
  if (v === 'cuti_bersama' || v === 'cb') return 'cuti_bersama';
  return null;
}

// 'Senin, 25 Des 2026'
export function formatTanggalLibur(tanggal) {
  return new Date(`${tanggal}T00:00:00Z`).toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}
