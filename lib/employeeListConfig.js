import { MODULE_OPTIONS } from '@/lib/employeeModules';

export const emptyForm = {
  nama: '',
  employee_id: '',
  email: '',
  client_id: '',
  status: 'Aktif',
  is_superadmin: false,
};

export const TEMPLATE_URL = '/templates/template-bulk-employee.xlsx';

// MODULE_OPTIONS itu list flat, tapi sub-permission-nya ditandai lewat
// prefix teks "— Sub: ..." pada label. Susun ulang jadi grup (modul utama +
// sub-modulnya) di sini, sekali saat load, supaya modal "Kelola Akses" bisa
// menampilkannya terindentasi/dikelompokkan alih-alih list checkbox lurus.
export const SUB_PREFIX = '— Sub: ';

export const MODULE_GROUPS = MODULE_OPTIONS.reduce((groups, mod) => {
  if (mod.label.startsWith(SUB_PREFIX)) {
    const parent = groups[groups.length - 1];
    const child = { ...mod, label: mod.label.slice(SUB_PREFIX.length) };
    if (parent) parent.children.push(child);
    else groups.push({ ...mod, label: child.label, children: [] }); // fallback kalau tidak ada parent di atasnya
  } else {
    groups.push({ ...mod, children: [] });
  }
  return groups;
}, []);

// Pilihan ukuran halaman untuk pagination tabel Employee List.
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// Kolom yang bisa disortir + cara ambil value-nya dari row employee.
export const SORT_COLUMNS = {
  nama: { label: 'Nama', get: (e) => (e.nama || '').toLowerCase() },
  employee_id: { label: 'Employee ID', get: (e) => e.employee_id || '' },
  email: { label: 'Email', get: (e) => (e.email || '').toLowerCase() },
  perusahaan: { label: 'Perusahaan', get: (e) => (e.companies?.nama_perusahaan || '').toLowerCase() },
  status: { label: 'Status', get: (e) => e.status || '' },
  is_superadmin: { label: 'Superadmin', get: (e) => (e.is_superadmin ? 1 : 0) },
};
