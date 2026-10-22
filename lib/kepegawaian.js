// Data kepegawaian (employees_master): tanggal bergabung, jenis hubungan kerja,
// tanggal berakhir kontrak. Helper murni — dipakai form Payroll Manager, detail
// Employee List, filter Employee List, widget dashboard, dan API PATCH master,
// supaya aturan validasinya tidak berbeda di tiap tempat.
//
// Semua tanggal berupa string 'YYYY-MM-DD' (kolom `date`). Sengaja TIDAK
// di-parse lewat `new Date('YYYY-MM-DD')` karena itu dianggap UTC dan bisa
// bergeser sehari di zona waktu lain; selisih hari dihitung dari Date.UTC.
import { todayJakarta } from '@/lib/serverTime';

export const JENIS_HUBUNGAN_KERJA_OPTIONS = [
  { value: 'PKWT', label: 'PKWT (Kontrak)' },
  { value: 'PKWTT', label: 'PKWTT (Tetap)' },
  { value: 'Magang', label: 'Magang' },
];

export const JENIS_HUBUNGAN_KERJA_VALUES = JENIS_HUBUNGAN_KERJA_OPTIONS.map((o) => o.value);

// Jenis yang punya tanggal berakhir. PKWTT tidak.
export const JENIS_DENGAN_AKHIR_KONTRAK = ['PKWT', 'Magang'];

// Kontrak yang berakhir dalam rentang ini dianggap "segera berakhir".
export const KONTRAK_PERINGATAN_HARI = 60;

const BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function parseIso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  // Tolak tanggal yang "meluber" (mis. 2026-02-30).
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) return null;
  return { y, m, d, utc: utc.getTime() };
}

export function isIsoDate(value) {
  return parseIso(value) !== null;
}

// '2026-12-31' -> '31 Des 2026'; kosong/invalid -> '-'.
export function formatTanggalKepegawaian(value) {
  const p = parseIso(value);
  if (!p) return '-';
  return `${p.d} ${BULAN_SINGKAT[p.m - 1]} ${p.y}`;
}

// Jumlah hari dari `today` ke `isoDate` (negatif = sudah lewat). null kalau invalid.
export function selisihHari(isoDate, today = todayJakarta()) {
  const target = parseIso(isoDate);
  const base = parseIso(today);
  if (!target || !base) return null;
  return Math.round((target.utc - base.utc) / 86_400_000);
}

// Tambah `hari` ke tanggal ISO (dipakai menghitung batas atas filter).
export function tambahHari(isoDate, hari) {
  const p = parseIso(isoDate);
  if (!p) return null;
  const d = new Date(p.utc + hari * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// Status kontrak untuk badge/widget.
//   kind: 'none'    — tidak ada tanggal berakhir (PKWTT / belum diisi)
//         'aman'    — masih lebih dari KONTRAK_PERINGATAN_HARI hari
//         'segera'  — berakhir dalam <= KONTRAK_PERINGATAN_HARI hari (termasuk hari ini)
//         'berakhir'— tanggalnya sudah lewat
export function statusKontrak(kontrakBerakhir, today = todayJakarta()) {
  const sisa = selisihHari(kontrakBerakhir, today);
  if (sisa === null) return { kind: 'none', sisaHari: null, label: '' };
  if (sisa < 0) return { kind: 'berakhir', sisaHari: sisa, label: `Berakhir ${Math.abs(sisa)} hari lalu` };
  if (sisa === 0) return { kind: 'segera', sisaHari: 0, label: 'Berakhir hari ini' };
  if (sisa <= KONTRAK_PERINGATAN_HARI) return { kind: 'segera', sisaHari: sisa, label: `${sisa} hari lagi` };
  return { kind: 'aman', sisaHari: sisa, label: `${sisa} hari lagi` };
}

// Masa kerja dari tanggal bergabung sampai hari ini, mis. "2 tahun 3 bulan".
// Tanggal bergabung di masa depan -> "Belum mulai".
export function masaKerja(tanggalBergabung, today = todayJakarta()) {
  const from = parseIso(tanggalBergabung);
  const to = parseIso(today);
  if (!from || !to) return '-';
  if (from.utc > to.utc) return 'Belum mulai';
  let bulan = (to.y - from.y) * 12 + (to.m - from.m);
  if (to.d < from.d) bulan -= 1;
  if (bulan < 1) return 'Kurang dari 1 bulan';
  const tahun = Math.floor(bulan / 12);
  const sisaBulan = bulan % 12;
  const bagian = [];
  if (tahun > 0) bagian.push(`${tahun} tahun`);
  if (sisaBulan > 0) bagian.push(`${sisaBulan} bulan`);
  return bagian.join(' ');
}

// Validasi tiga field sekaligus. Nilai kosong ('' / null / undefined) = belum
// diisi dan selalu valid. Mengembalikan pesan error (string) atau null.
export function validateKepegawaian({ tanggal_bergabung, jenis_hubungan_kerja, kontrak_berakhir }) {
  const bergabung = tanggal_bergabung || null;
  const jenis = jenis_hubungan_kerja || null;
  const berakhir = kontrak_berakhir || null;

  if (bergabung && !isIsoDate(bergabung)) return 'Tanggal bergabung tidak valid.';
  if (berakhir && !isIsoDate(berakhir)) return 'Tanggal berakhir kontrak tidak valid.';
  if (jenis && !JENIS_HUBUNGAN_KERJA_VALUES.includes(jenis)) return 'Jenis hubungan kerja tidak valid.';

  if (berakhir) {
    if (!jenis) return 'Pilih jenis hubungan kerja (PKWT atau Magang) untuk tanggal berakhir kontrak.';
    if (!JENIS_DENGAN_AKHIR_KONTRAK.includes(jenis)) {
      return 'PKWTT tidak punya tanggal berakhir kontrak. Kosongkan tanggal berakhir atau ubah jenisnya.';
    }
    if (bergabung && berakhir < bergabung) {
      return 'Tanggal berakhir kontrak tidak boleh sebelum tanggal bergabung.';
    }
  }
  return null;
}

// Filter Employee List. 'segera' & 'berakhir' hanya mengenai baris yang punya
// kontrak_berakhir; sisanya memfilter jenis hubungan kerja.
export const KONTRAK_FILTER_OPTIONS = [
  { value: '', label: 'Semua Kontrak' },
  { value: 'segera', label: `Berakhir ≤ ${KONTRAK_PERINGATAN_HARI} hari` },
  { value: 'berakhir', label: 'Sudah berakhir' },
  ...JENIS_HUBUNGAN_KERJA_OPTIONS.map((o) => ({ value: `jenis:${o.value}`, label: o.label })),
];

export function isKontrakFilterValid(value) {
  return KONTRAK_FILTER_OPTIONS.some((o) => o.value === value);
}

// Terapkan filter kontrak ke query builder employees_master.
//   segera  : hari ini .. hari ini + 60 (hari ini ikut)
//   berakhir: sebelum hari ini
export function applyKontrakFilter(query, filter, today = todayJakarta()) {
  if (filter === 'segera') {
    return query.gte('kontrak_berakhir', today).lte('kontrak_berakhir', tambahHari(today, KONTRAK_PERINGATAN_HARI));
  }
  if (filter === 'berakhir') {
    return query.lt('kontrak_berakhir', today);
  }
  if (filter.startsWith('jenis:')) {
    return query.eq('jenis_hubungan_kerja', filter.slice('jenis:'.length));
  }
  return query;
}
