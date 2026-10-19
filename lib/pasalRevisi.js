// Helper bersama riwayat revisi PASAL (components/peraturan/PasalRiwayat.js,
// components/peraturan/PasalTerhapus.js). Tabel dan RPC-nya ada di
// sql/20261019_peraturan_pasal_revisi.sql. Helper umum riwayat (label aksi,
// pesan error RPC, nama karyawan, selisih snapshot) dipakai ulang dari
// lib/peraturanRevisi.js.

// Kolom pasal yang dibandingkan dan ikut dipulihkan. HARUS sama dengan c_isi di
// fungsi SQL pulihkan_pasal_revisi().
export const PASAL_REVISI_KOLOM = [
  { key: 'nomor_pasal', label: 'Nomor Pasal' },
  { key: 'urutan', label: 'Urutan' },
  { key: 'judul', label: 'Bab / Bagian' },
  { key: 'isi', label: 'Isi Pasal' },
  { key: 'catatan', label: 'Catatan Internal' },
];

export const PASAL_REVISI_LIST_COLUMNS = 'id, versi, aksi, diubah_oleh, diubah_pada, sumber_revisi_id';

// Batas sel tabel LCS pada diff per kata (n x m). Di atas batas ini, bagian yang
// berbeda ditandai berubah seluruhnya (tanpa pencocokan kata) agar browser tidak macet.
const BATAS_SEL_LCS = 4_000_000;

// Pecah teks menjadi token kata dan spasi (spasi/baris baru dipertahankan sebagai token).
function pecah(teks) {
  return String(teks ?? '').match(/\s+|\S+/g) || [];
}

// Gabungkan token berurutan yang berstatus sama menjadi segmen: [{ teks, ubah }].
function rapatkan(token, ubah) {
  const hasil = [];
  token.forEach((t, i) => {
    const flag = ubah[i];
    const terakhir = hasil[hasil.length - 1];
    if (terakhir && terakhir.ubah === flag) terakhir.teks += t;
    else hasil.push({ teks: t, ubah: flag });
  });
  return hasil;
}

// Diff per kata dua teks. Return { sebelum, sesudah } berupa segmen
// [{ teks, ubah }]: `ubah` = true untuk bagian yang dihapus (di sebelum) atau
// ditambah (di sesudah). Bagian awal dan akhir yang sama dilewati lebih dulu,
// sisanya dicocokkan dengan LCS.
export function diffKata(a, b) {
  const x = pecah(a);
  const y = pecah(b);

  let awal = 0;
  while (awal < x.length && awal < y.length && x[awal] === y[awal]) awal += 1;
  let akhir = 0;
  while (
    akhir < x.length - awal &&
    akhir < y.length - awal &&
    x[x.length - 1 - akhir] === y[y.length - 1 - akhir]
  ) akhir += 1;

  const xm = x.slice(awal, x.length - akhir);
  const ym = y.slice(awal, y.length - akhir);
  const n = xm.length;
  const m = ym.length;

  const ubahX = new Array(n).fill(true);
  const ubahY = new Array(m).fill(true);

  if (n > 0 && m > 0 && n * m <= BATAS_SEL_LCS) {
    const lebar = m + 1;
    const tabel = new Uint16Array((n + 1) * lebar);
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        tabel[i * lebar + j] = xm[i] === ym[j]
          ? tabel[(i + 1) * lebar + j + 1] + 1
          : Math.max(tabel[(i + 1) * lebar + j], tabel[i * lebar + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (xm[i] === ym[j]) {
        ubahX[i] = false;
        ubahY[j] = false;
        i += 1;
        j += 1;
      } else if (tabel[(i + 1) * lebar + j] >= tabel[i * lebar + j + 1]) {
        i += 1;
      } else {
        j += 1;
      }
    }
  }

  const sama = (token) => token.map(() => false);
  return {
    sebelum: rapatkan(
      [...x.slice(0, awal), ...xm, ...x.slice(x.length - akhir)],
      [...sama(x.slice(0, awal)), ...ubahX, ...sama(x.slice(x.length - akhir))]
    ),
    sesudah: rapatkan(
      [...y.slice(0, awal), ...ym, ...y.slice(y.length - akhir)],
      [...sama(y.slice(0, awal)), ...ubahY, ...sama(y.slice(y.length - akhir))]
    ),
  };
}
