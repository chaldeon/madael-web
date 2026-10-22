// Aturan pengajuan koreksi absensi mandiri — dipakai route
// POST /api/attendance/koreksi (penegakan). Fungsi murni, tanpa import
// khusus-server.
import { tanggalValid } from '@/lib/leave';
import { tambahHari } from '@/lib/overtimeRules';

export const MAKS_ALASAN_KOREKSI = 500;

// Koreksi hanya untuk tanggal yang sudah lewat/hari ini dan tidak terlalu lama.
// CATATAN: 60 hari adalah asumsi awal (sekitar dua periode payroll), belum
// ditetapkan kebijakan — sesuaikan bila perlu.
export const KOREKSI_MAKS_HARI_KE_BELAKANG = 60;

// Format bukti: foto saja (sama seperti route upload sebelumnya).
export const BUKTI_KOREKSI_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png' };

const JAM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Jam dinding WIB ('HH:mm') pada tanggal 'YYYY-MM-DD' -> ISO UTC. Offset
// +07:00 eksplisit supaya hasilnya tidak bergantung zona waktu server
// (browser dulu memakai zona waktu perangkat).
export function waktuWibKeIso(tanggal, jam) {
  return new Date(`${tanggal}T${jam}:00+07:00`).toISOString();
}

// Validasi isian form. hariIni = 'YYYY-MM-DD' menurut WIB.
// Return { error } atau { tanggal, jamMasuk, jamPulang, alasan } (jam kosong -> null).
export function validasiPengajuanKoreksi({ tanggal, jamMasuk, jamPulang, alasan, hariIni }) {
  if (!tanggalValid(tanggal)) {
    return { error: 'Tanggal koreksi wajib diisi dengan benar.' };
  }
  if (tanggal > hariIni) {
    return { error: 'Tanggal koreksi tidak boleh di masa depan.' };
  }
  if (tanggal < tambahHari(hariIni, -KOREKSI_MAKS_HARI_KE_BELAKANG)) {
    return { error: `Koreksi hanya bisa diajukan untuk ${KOREKSI_MAKS_HARI_KE_BELAKANG} hari terakhir. Hubungi HR untuk tanggal yang lebih lama.` };
  }

  const masuk = typeof jamMasuk === 'string' && jamMasuk.trim() ? jamMasuk.trim() : null;
  const pulang = typeof jamPulang === 'string' && jamPulang.trim() ? jamPulang.trim() : null;
  if ((masuk && !JAM_RE.test(masuk)) || (pulang && !JAM_RE.test(pulang))) {
    return { error: 'Format jam tidak valid.' };
  }
  if (!masuk && !pulang) {
    return { error: 'Isi minimal salah satu: jam masuk atau jam pulang yang seharusnya.' };
  }

  const teksAlasan = typeof alasan === 'string' ? alasan.trim() : '';
  if (!teksAlasan) {
    return { error: 'Alasan koreksi wajib diisi.' };
  }
  if (teksAlasan.length > MAKS_ALASAN_KOREKSI) {
    return { error: `Alasan maksimal ${MAKS_ALASAN_KOREKSI} karakter.` };
  }

  return { tanggal, jamMasuk: masuk, jamPulang: pulang, alasan: teksAlasan };
}
