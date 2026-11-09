// Konstanta & helper murni halaman detail Payroll Run (app/employee/payroll/run/[runId]).
// Dipindah dari page.js supaya file halaman fokus ke state & tampilan.

export const STATUS_OPTIONS = ['Draft', 'Review', 'Approved'];

export const STATUS_STYLE = {
  Draft: 'bg-[#F3F4F6] text-[#4B5563]',
  Review: 'bg-amber-100 text-amber-800',
  Approved: 'bg-[#DCFCE7] text-[#166534]',
};

// Kolom yang bisa disortir. Overtime/Insentif/Kompensasi sengaja tidak
// masuk karena kolom itu input aktif yang sedang diedit per baris.
export const SORT_COLUMNS = {
  nama: { get: (i) => (i.employees_master?.nama || '').toLowerCase() },
  posisi: { get: (i) => (i.employees_master?.posisi || '').toLowerCase() },
  gaji_pokok: { get: (i) => Number(i.gaji_pokok) || 0 },
  allowance: { get: (i) => Number(i.allowance) || 0 },
  penalty: { get: (i) => Number(i.penalty) || 0 },
  pph21: { get: (i) => Number(i.pph21) || 0 },
  thp: { get: (i) => Number(i.take_home_pay) || 0 },
};

export const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export function periodeLabel(periode) {
  const [year, month] = (periode || '').split('-').map(Number);
  const nama = MONTH_NAMES[(month || 1) - 1];
  return nama ? `${nama} ${year}` : periode;
}

// Sama seperti di employee/payroll (NumberField) — dipakai buat tampilkan
// pemisah ribuan titik di input Overtime/Insentif/Kompensasi.
export function formatNumberDisplay(value) {
  if (value === '' || value === null || value === undefined) return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  return num.toLocaleString('id-ID');
}

// CSV manual, sama pendekatannya dengan Export rekap absensi (Task 12) — tanpa
// dependency tambahan.
export function toCsvValue(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// ── Export Transfer ───────────────────────────────────────────────────────
// Format MASIH GENERIK (belum mengikuti template bank tertentu): No, Nama
// Karyawan, Nama Bank, Nama Rekening, No Rekening, Nominal, Berita Transfer,
// plus baris TOTAL opsional untuk rekonsiliasi. Bank tujuan belum
// dikonfirmasi, jadi kolom perlu dicocokkan dulu dengan template bank sebelum
// diunggah.

const MIN_DIGIT_REKENING = 5;
const MAX_DIGIT_REKENING = 25;

// Rekening valid: angka (boleh spasi/strip pemisah), 5–25 digit — aturan yang
// sama dengan validasi simpan di lib/payrollMasterServer.js. Return string
// digit saja, atau null bila kosong/tidak valid.
export function normalisasiRekening(text) {
  const str = String(text ?? '').trim();
  if (!str || str.length > 40 || !/^[\d\-\s]+$/.test(str)) return null;
  const digits = str.replace(/\D/g, '');
  if (digits.length < MIN_DIGIT_REKENING || digits.length > MAX_DIGIT_REKENING) return null;
  return digits;
}

// Memisahkan item run menjadi:
//   baris     — layak ditransfer (rekening lengkap & valid, nominal > 0)
//   dilewati  — TIDAK ikut diekspor + alasannya (harus dibayar manual/dilengkapi)
//   tanpaBank — ikut diekspor tetapi nama bank belum diisi
export function siapkanTransfer(items, periode) {
  const berita = `Gaji ${periodeLabel(periode)}`;
  const baris = [];
  const dilewati = [];
  const tanpaBank = [];

  (items || []).forEach((item) => {
    const master = item.employees_master || {};
    const nama = master.nama || '(tanpa nama)';
    const nominal = Math.round(Number(item.take_home_pay) || 0);
    const namaRekening = String(master.nama_rekening || '').trim();
    const noRekening = normalisasiRekening(master.no_rekening);
    const bank = String(master.nama_bank || '').trim();

    let alasan = null;
    if (nominal <= 0) alasan = 'Nominal transfer 0 atau negatif';
    else if (!namaRekening && !String(master.no_rekening || '').trim()) alasan = 'Data rekening belum diisi';
    else if (!namaRekening) alasan = 'Nama rekening kosong';
    else if (!noRekening) alasan = 'No rekening kosong atau tidak valid (harus angka 5–25 digit)';

    if (alasan) {
      dilewati.push({ nama, alasan, nominal });
      return;
    }
    if (!bank) tanpaBank.push(nama);
    baris.push({ nama, bank, namaRekening, noRekening, nominal, berita });
  });

  baris.sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  const total = baris.reduce((sum, r) => sum + r.nominal, 0);
  return { baris, dilewati, tanpaBank, total };
}

// Unduh CSV transfer. Return ringkasan { jumlah, total, dilewati }; bila tidak
// ada baris layak, tidak ada file yang diunduh (jumlah = 0).
export function downloadTransferCsv(items, periode, { sertakanTotal = true } = {}) {
  const { baris, dilewati, total } = siapkanTransfer(items, periode);
  if (baris.length === 0) return { jumlah: 0, total: 0, dilewati };

  const header = ['No', 'Nama Karyawan', 'Nama Bank', 'Nama Rekening', 'No Rekening', 'Nominal', 'Berita Transfer'];
  const lines = [header.map(toCsvValue).join(',')];
  baris.forEach((r, idx) => {
    lines.push([idx + 1, r.nama, r.bank, r.namaRekening, r.noRekening, r.nominal, r.berita]
      .map(toCsvValue).join(','));
  });
  if (sertakanTotal) {
    lines.push(['', `TOTAL (${baris.length} penerima)`, '', '', '', total, ''].map(toCsvValue).join(','));
  }
  const csvContent = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transfer-payroll-${periode}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { jumlah: baris.length, total, dilewati };
}
