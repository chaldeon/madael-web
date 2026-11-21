// Rute dan kesiapan halaman Tool BPA1 di sisi UI (BPA-05).
//
// Tujuan file ini: daftar BPA1 tidak boleh menampilkan tautan ke halaman yang
// BELUM ada (tautan ke halaman kosong/404). Tiap halaman tujuan punya bendera
// kesiapan; tautan baru muncul setelah task yang membuat halamannya mengubah
// bendera itu menjadi true — cukup satu baris di file ini:
//
//   HALAMAN_BUAT_BPA1_ADA   -> ubah ke true di BPA-07 (form Buat BPA1)
//   HALAMAN_DETAIL_BPA1_ADA -> ubah ke true di BPA-19 (hasil/detail BPA1)
//
// ASUMSI: bentuk rute Detail (`/employee/payroll/bpa1/<document_id>`) dan
// query prefill form Buat (`?client_id=&tahun=`) adalah USULAN BPA-05. Halaman
// tujuannya belum ada; BPA-07 / BPA-19 yang menetapkan rute sebenarnya dan
// harus menyesuaikan fungsi di bawah bila berbeda.

export const RUTE_DAFTAR_BPA1 = '/employee/payroll/bpa1';
export const RUTE_BUAT_BPA1 = `${RUTE_DAFTAR_BPA1}/buat`;

export const HALAMAN_BUAT_BPA1_ADA = false;
export const HALAMAN_DETAIL_BPA1_ADA = false;

export function hrefBuatBpa1(clientId, tahun) {
  const params = new URLSearchParams({ client_id: String(clientId), tahun: String(tahun) });
  return `${RUTE_BUAT_BPA1}?${params.toString()}`;
}

export function hrefDetailBpa1(documentId) {
  return `${RUTE_DAFTAR_BPA1}/${encodeURIComponent(String(documentId))}`;
}
