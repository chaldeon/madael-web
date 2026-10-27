// Kebijakan kuota cuti tahunan — fungsi murni (tanpa akses DB), aman diimpor
// dari client maupun server. Satu tempat untuk aturan: hak cuti setelah masa
// kerja tertentu, jatah proporsional tahun pertama, dan carry-over. Nilai
// kebijakan disimpan di tabel leave_policies (satu baris) dan dibaca server
// lewat ambilKebijakanCuti (lib/leaveServer.js).
//
// DEFAULT_KEBIJAKAN_CUTI sengaja sama dengan perilaku sebelum fitur ini ada:
// 12 hari, langsung berhak, tidak proporsional, sisa tahun lalu hangus.

export const DEFAULT_KEBIJAKAN_CUTI = Object.freeze({
  jatah_default: 12, // jatah dasar kalau employees_master.jatah_cuti_tahunan kosong
  min_masa_kerja_bulan: 0, // 0 = langsung berhak; 12 = berhak setelah 12 bulan bekerja
  proporsional_tahun_pertama: false, // jatah tahun masuk dihitung per bulan
  carry_over_maks_hari: 0, // 0 = sisa tahun lalu hangus
});

export const BATAS_KEBIJAKAN_CUTI = { min: 0, max: 60 };

// Batas jatah cuti tahunan per karyawan (hari) di form Payroll Manager.
export const BATAS_JATAH_CUTI_KARYAWAN = { min: 0, max: 365 };

// Nilai form jatah cuti per karyawan -> { value } atau { error }.
// Kosong ('' / null / undefined) = jatah default; 0 adalah nilai sah (mis. magang
// tanpa hak cuti) dan TIDAK boleh diganti default, jadi jangan pakai `|| 12`.
export function parseJatahCutiKaryawan(raw, fallback = DEFAULT_KEBIJAKAN_CUTI.jatah_default) {
  if (raw === '' || raw === null || raw === undefined) return { value: fallback };
  const n = Number(raw);
  const { min, max } = BATAS_JATAH_CUTI_KARYAWAN;
  if (!Number.isInteger(n) || n < min || n > max) {
    return { error: `Jatah cuti tahunan harus bilangan bulat ${min}–${max} hari.` };
  }
  return { value: n };
}

// Tanggal hari ini menurut WIB, format 'YYYY-MM-DD' (server Vercel berjalan di UTC).
export function tanggalHariIni() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function angka(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Row leave_policies (atau null) -> objek kebijakan lengkap dengan default.
export function normalisasiKebijakan(row) {
  const d = DEFAULT_KEBIJAKAN_CUTI;
  if (!row) return { ...d };
  return {
    jatah_default: angka(row.jatah_default, d.jatah_default),
    min_masa_kerja_bulan: angka(row.min_masa_kerja_bulan, d.min_masa_kerja_bulan),
    proporsional_tahun_pertama: row.proporsional_tahun_pertama === true,
    carry_over_maks_hari: angka(row.carry_over_maks_hari, d.carry_over_maks_hari),
  };
}

const LABEL_FIELD = {
  jatah_default: 'Jatah dasar',
  min_masa_kerja_bulan: 'Masa kerja minimum',
  carry_over_maks_hari: 'Carry-over maksimal',
};

// Validasi input dari form. Return { ok: true, value } atau { ok: false, error }.
export function validasiKebijakan(input) {
  const value = {};
  for (const key of Object.keys(LABEL_FIELD)) {
    const raw = input?.[key];
    const n = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isInteger(n) || n < BATAS_KEBIJAKAN_CUTI.min || n > BATAS_KEBIJAKAN_CUTI.max) {
      return { ok: false, error: `${LABEL_FIELD[key]} harus bilangan bulat ${BATAS_KEBIJAKAN_CUTI.min}–${BATAS_KEBIJAKAN_CUTI.max}.` };
    }
    value[key] = n;
  }
  if (typeof input?.proporsional_tahun_pertama !== 'boolean') {
    return { ok: false, error: 'Pilihan proporsional tahun pertama tidak valid.' };
  }
  value.proporsional_tahun_pertama = input.proporsional_tahun_pertama;
  return { ok: true, value };
}

function parseTanggal(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Tanggal 'YYYY-MM-DD' + sejumlah bulan; hari dipotong ke akhir bulan target
// (31 Jan + 1 bulan = 28/29 Feb).
export function tambahBulan(tanggal, bulan) {
  const t = parseTanggal(tanggal);
  if (!t) return null;
  const total = t.y * 12 + (t.m - 1) + bulan;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const hariDiBulan = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(t.d, hariDiBulan))}`;
}

// Jatah dasar (tanpa carry-over) untuk satu tahun.
// - master.jatah_cuti_tahunan = jatah per karyawan; kosong -> jatah_default.
// - Masa kerja minimum: jatah 0 sampai acuanTanggal >= tanggal_bergabung + N bulan.
// - Proporsional: di tahun masuk, jatah dikali (bulan tersisa / 12), dibulatkan
//   ke bawah. Bulan masuk dihitung penuh.
// - tanggal_bergabung kosong: dianggap sudah berhak penuh (tanpa proporsional).
export function hitungJatahTahun(master, tahun, kebijakan, acuanTanggal) {
  let jatah = master?.jatah_cuti_tahunan ?? kebijakan.jatah_default;
  const join = parseTanggal(master?.tanggal_bergabung);

  let berhakMulai = null;
  let belumBerhak = false;
  if (join && kebijakan.min_masa_kerja_bulan > 0) {
    berhakMulai = tambahBulan(master.tanggal_bergabung, kebijakan.min_masa_kerja_bulan);
    belumBerhak = acuanTanggal < berhakMulai;
  }

  if (kebijakan.proporsional_tahun_pertama && join && join.y === tahun) {
    jatah = Math.floor((jatah * (12 - join.m + 1)) / 12);
  }
  if (belumBerhak) jatah = 0;

  return { jatahDasar: jatah, belumBerhak, berhakMulai };
}

// Carry-over yang berlaku di `tahun`.
// 1) Kalau sudah tercatat untuk tahun ini (cuti_carry_over_tahun = tahun),
//    nilai itu yang dipakai (termasuk koreksi manual HR).
// 2) Kalau belum, dihitung dari sisa tahun lalu, dibatasi carry_over_maks_hari.
//    Counter cuti_terpakai hanya melacak satu tahun; kalau sudah bergeser ke
//    tahun ini tanpa carry tercatat, pemakaian tahun lalu tidak diketahui ->
//    0 (HR bisa isi manual di Payroll Manager).
export function hitungCarryOver(master, tahun, kebijakan) {
  if (master?.cuti_carry_over_tahun === tahun) {
    return Math.max(0, Number(master.cuti_carry_over) || 0);
  }
  if (!(kebijakan.carry_over_maks_hari > 0)) return 0;

  const prev = tahun - 1;
  const join = parseTanggal(master?.tanggal_bergabung);
  if (join && join.y > prev) return 0; // belum bekerja di tahun lalu

  const tahunCounter = master?.cuti_terpakai_tahun ?? null;
  if (tahunCounter !== null && tahunCounter >= tahun) return 0;

  const terpakaiPrev = tahunCounter === prev ? (Number(master.cuti_terpakai) || 0) : 0;
  const carryPrev = master?.cuti_carry_over_tahun === prev ? (Number(master.cuti_carry_over) || 0) : 0;
  const { jatahDasar } = hitungJatahTahun(master, prev, kebijakan, `${prev}-12-31`);
  const sisaPrev = Math.max(0, jatahDasar + carryPrev - terpakaiPrev);
  return Math.floor(Math.min(kebijakan.carry_over_maks_hari, sisaPrev));
}

// Saldo cuti satu karyawan untuk `tahun`, dengan lazy reset: counter
// cuti_terpakai yang bukan milik tahun ini dianggap 0.
// jatah = jatahDasar + carryOver (total hak tahun ini).
export function hitungSaldoCuti(master, tahun, kebijakan = DEFAULT_KEBIJAKAN_CUTI, hariIni = tanggalHariIni()) {
  const { jatahDasar, belumBerhak, berhakMulai } = hitungJatahTahun(master, tahun, kebijakan, hariIni);
  const carryOver = hitungCarryOver(master, tahun, kebijakan);
  const jatah = jatahDasar + carryOver;
  const terpakai = master.cuti_terpakai_tahun === tahun ? (master.cuti_terpakai || 0) : 0;
  return {
    jatah,
    jatahDasar,
    carryOver,
    terpakai,
    sisa: Math.max(0, jatah - terpakai),
    tahun,
    belumBerhak,
    berhakMulai,
  };
}
