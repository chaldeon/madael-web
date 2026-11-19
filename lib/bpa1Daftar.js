// Penyusun daftar BPA1 per klien untuk satu tahun pajak (BPA-04).
//
// MURNI: tanpa akses DB dan tanpa import, sehingga bisa diuji terpisah. Query
// ada di app/api/bpa1/route.js; file ini hanya menggabungkan hasilnya.
//
// ASUMSI (belum divalidasi — tabel bpa1_* adalah USULAN BPA-01 dan belum
// diterapkan di DB mana pun): bpa1_documents punya id, client_id, tahun_pajak,
// versi, status, is_provisional; bpa1_items punya document_id.

export const STATUS_BELUM_DIBUAT = 'Belum dibuat';

// Asal angka jumlah_karyawan pada satu baris daftar:
//  - 'dokumen'          : jumlah baris bpa1_items milik dokumen yang ditampilkan
//                         (angka yang sama dengan halaman hasil/detail BPA1).
//  - 'employees_master' : BELUM ada dokumen, jadi dihitung dari semua baris
//                         employees_master klien (sama dengan hitungan di halaman
//                         Payroll Run). Ini PERKIRAAN: dokumen nanti dibentuk dari
//                         item Payroll Run, jadi angkanya bisa berbeda (mis.
//                         karyawan dengan akun Nonaktif tidak ikut run).
export const SUMBER_JUMLAH_DOKUMEN = 'dokumen';
export const SUMBER_JUMLAH_MASTER = 'employees_master';

// Satu klien bisa punya beberapa versi untuk tahun yang sama (pembetulan =
// versi baru). Daftar menampilkan versi TERTINGGI. Return Map<client_id, dokumen>.
export function pilihDokumenTerbaruPerKlien(documents) {
  const terbaru = new Map();
  for (const doc of documents || []) {
    const sekarang = terbaru.get(doc.client_id);
    if (!sekarang || doc.versi > sekarang.versi) terbaru.set(doc.client_id, doc);
  }
  return terbaru;
}

// Hitung baris per nilai `kunci`. Baris dengan kunci kosong diabaikan.
export function hitungPer(rows, kunci) {
  const hasil = new Map();
  for (const row of rows || []) {
    const nilai = row[kunci];
    if (nilai === null || nilai === undefined || nilai === '') continue;
    hasil.set(nilai, (hasil.get(nilai) || 0) + 1);
  }
  return hasil;
}

// companies    : [{ id, nama_perusahaan }] (urutan dipertahankan)
// documents    : baris bpa1_documents untuk tahun yang diminta
// itemRows     : baris bpa1_items ({ document_id }) milik dokumen TERBARU saja
// masterRows   : baris employees_master ({ client_id })
//
// Return satu entri per klien — tidak ada klien yang dibuang atau digandakan.
export function susunDaftarBpa1({ companies, documents, itemRows, masterRows }) {
  const terbaru = pilihDokumenTerbaruPerKlien(documents);
  const itemPerDokumen = hitungPer(itemRows, 'document_id');
  const masterPerKlien = hitungPer(masterRows, 'client_id');

  return (companies || []).map((klien) => {
    const doc = terbaru.get(klien.id);
    if (!doc) {
      return {
        client_id: klien.id,
        nama_perusahaan: klien.nama_perusahaan,
        ada_dokumen: false,
        document_id: null,
        status: STATUS_BELUM_DIBUAT,
        versi: null,
        is_provisional: null,
        jumlah_karyawan: masterPerKlien.get(klien.id) || 0,
        sumber_jumlah: SUMBER_JUMLAH_MASTER,
      };
    }
    return {
      client_id: klien.id,
      nama_perusahaan: klien.nama_perusahaan,
      ada_dokumen: true,
      document_id: doc.id,
      status: doc.status,
      versi: doc.versi,
      is_provisional: !!doc.is_provisional,
      jumlah_karyawan: itemPerDokumen.get(doc.id) || 0,
      sumber_jumlah: SUMBER_JUMLAH_DOKUMEN,
    };
  });
}
