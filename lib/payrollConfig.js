// Konstanta & helper murni halaman Payroll Manager (app/employee/payroll).
// Dipindah dari page.js supaya file halaman fokus ke state & tampilan.

import { PTKP_DATA, JKK_OPTIONS } from '@/lib/payroll/calculations';

export const STATUS_OPTIONS = ['PHL', 'Tetap'];

export const NPWP_OPTIONS = [
  { value: '', label: '— Belum diisi —' },
  { value: 'ada', label: 'Ada NPWP' },
  { value: 'tidak', label: 'Tidak Ada NPWP' },
];

export const PTKP_OPTIONS = [
  { value: '', label: '— Belum diisi —' },
  ...Object.entries(PTKP_DATA).map(([key, v]) => ({ value: key, label: v.label })),
];

export const JKK_SELECT_OPTIONS = [
  { value: '', label: '— Belum diisi —' },
  ...JKK_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
];

export function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const EMPTY_FORM = {
  nama: '',
  client_id: '',
  posisi: '',
  status: 'PHL',
  gaji_pokok: 0,
  tunjangan: 0,
  komponen_lain: [],
  linked_employee_id: '',
  status_ptkp: '',
  npwp_status: '',
  npwp: '',
  jkk_rate: '',
  no_bpjs_kesehatan: '',
  no_bpjs_ketenagakerjaan: '',
  nama_rekening: '',
  no_rekening: '',
  jatah_cuti_tahunan: 12,
};

export function formatNumberDisplay(value) {
  if (value === '' || value === null || value === undefined) return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  return num.toLocaleString('id-ID');
}

export function totalTunjangan(row) {
  const komponenTotal = Object.values(row.komponen_lain || {}).reduce(
    (sum, v) => sum + (Number(v) || 0),
    0
  );
  return (Number(row.tunjangan) || 0) + komponenTotal;
}

// Kolom yang bisa disortir — pola sama seperti app/employee/list. ctx berisi
// clientName untuk resolve nama klien dari client_id.
export const SORT_COLUMNS = {
  nama: { get: (row) => (row.employees?.nama || row.nama || '').toLowerCase() },
  klien: { get: (row, ctx) => ctx.clientName(row.client_id).toLowerCase() },
  posisi: { get: (row) => (row.posisi || '').toLowerCase() },
  status: { get: (row) => row.status || '' },
  akun_absensi: { get: (row) => (row.linked_employee_id ? 1 : 0) },
  gaji_pokok: { get: (row) => Number(row.gaji_pokok) || 0 },
  allowance: { get: (row) => totalTunjangan(row) },
};

export function objToPairs(obj) {
  return Object.entries(obj || {}).map(([key, value]) => ({ key, value }));
}

export function pairsToObj(pairs) {
  const obj = {};
  for (const p of pairs) {
    if (p.key.trim()) obj[p.key.trim()] = Number(p.value) || 0;
  }
  return obj;
}
