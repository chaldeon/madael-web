// Riwayat kontrak PKWT/Magang (tabel employee_contracts). Helper murni — dipakai
// route API perpanjangan, widget Kontrak Berakhir, panel di detail karyawan, dan
// modal perpanjangan, supaya hitungan masa kumulatif dan aturan validasinya sama
// di server maupun browser.
//
// Semua tanggal berupa string 'YYYY-MM-DD'. Perhitungan memakai Date.UTC lewat
// helper lib/kepegawaian.js (tidak lewat `new Date('YYYY-MM-DD')`).
import { JENIS_DENGAN_AKHIR_KONTRAK, isIsoDate, tambahHari } from '@/lib/kepegawaian';

// Batas total masa kontrak per jenis, termasuk perpanjangan.
//
// CATATAN HUKUM: angka di bawah adalah ASUMSI AWAL dan WAJIB divalidasi tim legal
// Madael sebelum dijadikan acuan. PKWT: PP 35/2021 Pasal 8 (paling lama 5 tahun
// termasuk perpanjangan). Magang: dianggap 12 bulan (Permenaker 6/2020); magang
// bukan PKWT sehingga masa keduanya TIDAK digabung. `peringatanBulan` = ambang
// "mendekati batas" (sisa masa sebelum batas), murni kebijakan tampilan.
// Mengubah angka cukup di sini.
export const BATAS_DURASI_KONTRAK = {
  PKWT: { batasBulan: 60, peringatanBulan: 6, dasar: 'PP 35/2021 Pasal 8' },
  Magang: { batasBulan: 12, peringatanBulan: 2, dasar: 'Permenaker 6/2020' },
};

export const MAX_NOMOR_KONTRAK = 100;
export const MAX_CATATAN_KONTRAK = 500;

function pecahTanggal(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

function hariDalamBulan(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
}

// Bulan + hari kalender inklusif untuk satu periode (cara sama dengan Kalkulator
// PKWT: 1 Feb s.d. 31 Jul = pas 6 bulan 0 hari).
export function durasiPeriode(mulai, berakhir) {
  if (!isIsoDate(mulai) || !isIsoDate(berakhir) || berakhir < mulai) return null;
  const a = pecahTanggal(mulai);
  const b = pecahTanggal(tambahHari(berakhir, 1));
  let bulan = (b.y - a.y) * 12 + (b.m - a.m);
  let hari = b.d - a.d;
  if (hari < 0) {
    bulan -= 1;
    const prevBulan = b.m === 1 ? 12 : b.m - 1;
    const prevTahun = b.m === 1 ? b.y - 1 : b.y;
    hari += hariDalamBulan(prevTahun, prevBulan);
  }
  return { bulan, hari };
}

// Normalisasi: 30 hari = 1 bulan.
function normalisasi(totalHari30) {
  return { bulan: Math.floor(totalHari30 / 30), hari: totalHari30 % 30 };
}

// '27 bulan 5 hari' -> '2 tahun 3 bulan 5 hari'; nol dilewati.
export function formatDurasi({ bulan, hari }) {
  const tahun = Math.floor(bulan / 12);
  const sisaBulan = bulan % 12;
  const bagian = [];
  if (tahun > 0) bagian.push(`${tahun} tahun`);
  if (sisaBulan > 0) bagian.push(`${sisaBulan} bulan`);
  if (hari > 0) bagian.push(`${hari} hari`);
  return bagian.length ? bagian.join(' ') : '0 hari';
}

// Gabungkan periode yang tumpang tindih/bersambung agar hari yang sama tidak
// dihitung dua kali. Jeda antar kontrak tidak dihitung sebagai masa kerja.
function gabungkanPeriode(periode) {
  const urut = periode
    .filter((p) => isIsoDate(p.tanggal_mulai) && isIsoDate(p.tanggal_berakhir) && p.tanggal_berakhir >= p.tanggal_mulai)
    .map((p) => ({ mulai: p.tanggal_mulai, berakhir: p.tanggal_berakhir }))
    .sort((x, y) => (x.mulai < y.mulai ? -1 : x.mulai > y.mulai ? 1 : 0));
  const hasil = [];
  for (const p of urut) {
    const last = hasil[hasil.length - 1];
    if (last && p.mulai <= tambahHari(last.berakhir, 1)) {
      if (p.berakhir > last.berakhir) last.berakhir = p.berakhir;
    } else {
      hasil.push({ ...p });
    }
  }
  return hasil;
}

// Daftar kontrak yang dipakai untuk menghitung. Bila riwayat belum ada tetapi
// data kepegawaian lengkap (jenis PKWT/Magang + tanggal bergabung + tanggal
// berakhir), dipakai satu periode "perkiraan" bergabung -> berakhir. Hal yang sama
// dibuat server saat perpanjangan pertama (dan oleh migrasi untuk data lama).
export function kontrakEfektif(contracts, master) {
  if (Array.isArray(contracts) && contracts.length > 0) return contracts;
  const jenis = master?.jenis_hubungan_kerja;
  if (
    JENIS_DENGAN_AKHIR_KONTRAK.includes(jenis) &&
    isIsoDate(master?.tanggal_bergabung) &&
    isIsoDate(master?.kontrak_berakhir) &&
    master.tanggal_bergabung <= master.kontrak_berakhir
  ) {
    return [{ jenis, tanggal_mulai: master.tanggal_bergabung, tanggal_berakhir: master.kontrak_berakhir, perkiraan: true }];
  }
  return [];
}

// Ringkasan masa kumulatif untuk satu jenis.
//   status: 'none'      — jenis tanpa batas (PKWTT) atau belum ada periode
//           'aman'      — sisa masih di atas ambang peringatan
//           'mendekati' — sisa <= ambang peringatan (termasuk tepat di batas)
//           'melewati'  — total sudah melebihi batas
export function ringkasanDurasi(contracts, jenis) {
  const aturan = BATAS_DURASI_KONTRAK[jenis];
  const periode = gabungkanPeriode((contracts || []).filter((c) => c.jenis === jenis));
  if (!aturan || periode.length === 0) {
    return { jenis, status: 'none', total: { bulan: 0, hari: 0 }, batasBulan: aturan?.batasBulan ?? null, sisa: null, label: '', dasar: aturan?.dasar ?? null };
  }

  let totalHari = 0;
  for (const p of periode) {
    const d = durasiPeriode(p.mulai, p.berakhir);
    totalHari += d.bulan * 30 + d.hari;
  }
  const batasHari = aturan.batasBulan * 30;
  const total = normalisasi(totalHari);
  const batasLabel = formatDurasi({ bulan: aturan.batasBulan, hari: 0 });

  if (totalHari > batasHari) {
    const lebih = normalisasi(totalHari - batasHari);
    return {
      jenis, status: 'melewati', total, batasBulan: aturan.batasBulan, sisa: null, dasar: aturan.dasar,
      label: `Melebihi batas ${batasLabel} sebanyak ${formatDurasi(lebih)}`,
    };
  }
  const sisa = normalisasi(batasHari - totalHari);
  const mendekati = batasHari - totalHari <= aturan.peringatanBulan * 30;
  return {
    jenis, status: mendekati ? 'mendekati' : 'aman', total, batasBulan: aturan.batasBulan, sisa, dasar: aturan.dasar,
    label: `Sisa ${formatDurasi(sisa)} dari batas ${batasLabel}`,
  };
}

// Validasi input perpanjangan. `kontrakAda` = daftar efektif (riwayat atau
// perkiraan); `kontrakBerakhirMaster` = employees_master.kontrak_berakhir saat ini.
// Mengembalikan { values } atau { error }.
export function validatePerpanjangan(body, { kontrakAda = [], kontrakBerakhirMaster = null } = {}) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { error: 'Data perpanjangan tidak valid.' };
  const { tanggal_mulai, tanggal_berakhir } = body;
  if (!isIsoDate(tanggal_mulai)) return { error: 'Tanggal mulai kontrak baru tidak valid.' };
  if (!isIsoDate(tanggal_berakhir)) return { error: 'Tanggal berakhir kontrak baru tidak valid.' };
  if (tanggal_berakhir < tanggal_mulai) return { error: 'Tanggal berakhir tidak boleh sebelum tanggal mulai.' };

  const teks = (v, max, label) => {
    if (v === undefined || v === null) return { value: null };
    if (typeof v !== 'string') return { error: `${label} tidak valid.` };
    const t = v.trim();
    if (t.length > max) return { error: `${label} maksimal ${max} karakter.` };
    return { value: t === '' ? null : t };
  };
  const nomor = teks(body.nomor_kontrak, MAX_NOMOR_KONTRAK, 'Nomor kontrak');
  if (nomor.error) return { error: nomor.error };
  const catatan = teks(body.catatan, MAX_CATATAN_KONTRAK, 'Catatan');
  if (catatan.error) return { error: catatan.error };

  // Kontrak baru harus dimulai setelah akhir kontrak terakhir yang diketahui.
  const akhirTerakhir = [kontrakBerakhirMaster, ...kontrakAda.map((c) => c.tanggal_berakhir)]
    .filter((v) => isIsoDate(v))
    .sort()
    .pop();
  if (akhirTerakhir && tanggal_mulai <= akhirTerakhir) {
    return { error: `Kontrak baru harus dimulai setelah kontrak terakhir berakhir (${akhirTerakhir}).` };
  }

  return {
    values: {
      tanggal_mulai,
      tanggal_berakhir,
      nomor_kontrak: nomor.value,
      catatan: catatan.value,
      konfirmasi_melebihi_batas: body.konfirmasi_melebihi_batas === true,
    },
  };
}

// Tautan Kalkulator PKWT dengan tanggal terisi. Sengaja hanya tanggal: gaji tidak
// dibawa lewat URL (masuk riwayat browser dan log).
export function tautanKalkulatorPkwt(kontrak) {
  if (!kontrak || !isIsoDate(kontrak.tanggal_mulai) || !isIsoDate(kontrak.tanggal_berakhir)) return '/kalkulator-pkwt';
  return `/kalkulator-pkwt?mulai=${kontrak.tanggal_mulai}&berakhir=${kontrak.tanggal_berakhir}`;
}
