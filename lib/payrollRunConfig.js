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
// dependency tambahan. Kolom generik dulu (nama rekening, no rekening,
// nominal); format detail perlu dikonfirmasi Daniel sesuai bank tujuan.
export function toCsvValue(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function downloadTransferCsv(items, periode) {
  const header = ['Nama Karyawan', 'Nama Rekening', 'No Rekening', 'Nominal'];
  const lines = [header.map(toCsvValue).join(',')];
  items.forEach((item) => {
    lines.push([
      item.employees_master?.nama || '',
      item.employees_master?.nama_rekening || '',
      item.employees_master?.no_rekening || '',
      item.take_home_pay,
    ].map(toCsvValue).join(','));
  });
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
}
