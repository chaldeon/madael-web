// Helper murni (tanpa React/Supabase) untuk audit verifikasi wajah di panel
// "Perlu Review" (components/AbsensiReviewPanel.js).
//
// Latar belakang: descriptor wajah dari frame kamera dihitung di browser lalu dikirim
// ke server (lihat app/api/attendance/clock/route.js). Server membandingkannya dengan
// descriptor referensi, tapi tidak bisa membuktikan descriptor itu berasal dari foto
// yang diunggah. Karena itu, selain status "cocok/tidak cocok", panel memakai dua
// sinyal tambahan yang bisa dihitung dari data yang sudah tersimpan
// (attendance.wajah_similarity = jarak Euclidean ke referensi), tanpa teknologi baru:
//   1. jarak yang IDENTIK berulang pada hari berbeda — frame kamera asli hampir tidak
//      mungkin menghasilkan jarak yang persis sama dua kali, jadi ini tanda descriptor
//      yang dikirim ulang/dipalsukan.
//   2. jarak ~0 — descriptor yang dikirim sama dengan descriptor referensi (disalin).
// Keduanya HANYA penanda untuk ditinjau manusia; tidak pernah memblokir absen.

// Jumlah baris absensi (hari berbeda) dengan jarak identik untuk satu karyawan dalam
// satu bulan agar ditandai. Dipilih 3 (bukan 2) supaya kebetulan angka sama pada
// kolom berpresisi terbatas tidak menimbulkan penanda palsu.
export const DESCRIPTOR_IDENTIK_MIN_HARI = 3;

// Jarak sekecil ini ke referensi = descriptor praktis identik dengan referensi.
export const DESCRIPTOR_SAMA_REFERENSI_MAKS_JARAK = 0.0001;

// Jumlah baris sampel acak untuk audit berkala.
export const SAMPEL_AUDIT_JUMLAH = 10;

// rows: [{ id, employee_id, wajah_similarity }] (satu periode).
// Return Map<id, { samaReferensi: boolean, identikHari: number }> — hanya baris yang
// ada anomalinya (identikHari = 0 kalau tidak identik berulang).
export function findDescriptorAnomalies(rows) {
  const perKaryawan = new Map(); // employee_id -> Map(jarak -> [id, ...])
  for (const row of rows || []) {
    const jarak = row?.wajah_similarity == null ? NaN : Number(row.wajah_similarity);
    if (!Number.isFinite(jarak) || jarak < 0) continue;
    let perJarak = perKaryawan.get(row.employee_id);
    if (!perJarak) {
      perJarak = new Map();
      perKaryawan.set(row.employee_id, perJarak);
    }
    const ids = perJarak.get(jarak);
    if (ids) ids.push({ id: row.id, jarak });
    else perJarak.set(jarak, [{ id: row.id, jarak }]);
  }

  const result = new Map();
  for (const perJarak of perKaryawan.values()) {
    for (const entries of perJarak.values()) {
      const identikHari = entries.length >= DESCRIPTOR_IDENTIK_MIN_HARI ? entries.length : 0;
      for (const { id, jarak } of entries) {
        const samaReferensi = jarak <= DESCRIPTOR_SAMA_REFERENSI_MAKS_JARAK;
        if (identikHari > 0 || samaReferensi) result.set(id, { samaReferensi, identikHari });
      }
    }
  }
  return result;
}

// Ambil `n` elemen acak tanpa pengulangan (Fisher-Yates parsial pada salinan).
export function pickSample(items, n = SAMPEL_AUDIT_JUMLAH, rng = Math.random) {
  const arr = Array.from(items || []);
  const take = Math.min(Math.max(0, n), arr.length);
  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(rng() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, take);
}
