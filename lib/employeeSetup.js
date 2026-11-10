// SERVER ONLY — kelengkapan "setup akun" karyawan baru: (1) akses modul default
// dan (2) satu baris employees_master draft yang ter-link ke akun. Dipakai
// bersama oleh pembuatan satuan (/api/employee/create), impor massal
// (/api/employee/bulk-create), dan aksi "Perbaiki Setup Akun"
// (/api/employee/[id]/setup).
//
// Kegagalan di sini TIDAK menggagalkan pembuatan akun (akun & undangan email
// sudah jadi), tapi HARUS dilaporkan ke HR lewat `warnings` — dulu hanya
// console.error sehingga karyawan baru bisa tanpa menu atau tanpa data payroll
// dan HR baru tahu saat karyawan komplain.
//
// `admin` WAJIB client service role (createAdminClient()).
import { DEFAULT_MODULE_ACCESS } from '@/lib/employeeModules';
import { ambilKebijakanCuti } from '@/lib/leaveServer';

export const PESAN_SETUP_GAGAL = {
  akses_default:
    'Akses modul default gagal diberikan, jadi karyawan belum bisa membuka menu apa pun.',
  draft_master:
    'Draft data payroll (employees_master) gagal dibuat, jadi jatah cuti, slip gaji, dan payroll belum berjalan untuk karyawan ini.',
};

// Superadmin sudah otomatis punya akses ke semua modul, jadi tidak perlu row di
// employee_modules. `baru: true` = akun baru saja dibuat (tidak mungkin sudah ada
// row), jadi pengecekan baris yang sudah ada dilewati.
async function pastikanAksesDefault(admin, emp, baru) {
  if (emp.is_superadmin) return { ok: true, dibuat: 0 };
  try {
    let sudahAda = new Set();
    if (!baru) {
      const { data, error } = await admin
        .from('employee_modules')
        .select('module_name')
        .eq('employee_id', emp.id);
      if (error) {
        console.error('Gagal baca akses modul:', error.message);
        return { ok: false, dibuat: 0 };
      }
      sudahAda = new Set((data || []).map((r) => r.module_name));
    }

    const barisBaru = DEFAULT_MODULE_ACCESS
      .filter((module_name) => !sudahAda.has(module_name))
      .map((module_name) => ({ employee_id: emp.id, module_name }));
    if (barisBaru.length === 0) return { ok: true, dibuat: 0 };

    const { error } = await admin.from('employee_modules').insert(barisBaru);
    if (error) {
      console.error('Gagal insert akses default:', error.message);
      return { ok: false, dibuat: 0 };
    }
    return { ok: true, dibuat: barisBaru.length };
  } catch (err) {
    console.error('Gagal menyiapkan akses default:', err);
    return { ok: false, dibuat: 0 };
  }
}

// Fase 3.1 — satu baris employees_master kosong yang langsung ter-link ke akun
// (linked_employee_id), supaya Payroll Manager, cuti, dan slip langsung punya
// data dasar. Yang dicek hanya baris yang ter-link ke akun ini: master yang
// dibuat manual dengan nama sama tapi belum ter-link TIDAK dianggap ada, supaya
// tidak menebak-nebak kecocokan nama.
async function pastikanDraftMaster(admin, emp, baru, kebijakanCuti) {
  try {
    if (!baru) {
      const { data, error } = await admin
        .from('employees_master')
        .select('id')
        .eq('linked_employee_id', emp.id)
        .limit(1);
      if (error) {
        console.error('Gagal cek draft employees_master:', error.message);
        return { ok: false, dibuat: false };
      }
      if (data && data.length > 0) return { ok: true, dibuat: false };
    }

    // Jatah awal mengikuti kebijakan kuota cuti (gagal baca -> default 12).
    const kebijakan = kebijakanCuti || (await ambilKebijakanCuti(admin));
    const { error } = await admin.from('employees_master').insert([
      {
        nama: emp.nama,
        client_id: emp.client_id,
        posisi: '',
        status: 'PHL',
        gaji_pokok: 0,
        tunjangan: 0,
        komponen_lain: {},
        linked_employee_id: emp.id,
        jatah_cuti_tahunan: kebijakan.kebijakan.jatah_default,
      },
    ]);
    if (error) {
      console.error('Gagal buat draft employees_master:', error.message);
      return { ok: false, dibuat: false };
    }
    return { ok: true, dibuat: true };
  } catch (err) {
    console.error('Gagal menyiapkan draft employees_master:', err);
    return { ok: false, dibuat: false };
  }
}

// Lengkapi setup satu akun. Idempotent: hanya membuat yang belum ada, aman
// dijalankan ulang (dipakai juga oleh aksi "Perbaiki Setup Akun").
//
// emp   : { id, nama, client_id, is_superadmin }
// opsi  : { baru, kebijakanCuti }
//         baru          — true kalau akun baru dibuat (lewati cek "sudah ada")
//         kebijakanCuti — hasil ambilKebijakanCuti() yang sudah dibaca pemanggil
//                         (impor massal membacanya sekali untuk semua baris)
// return: { dibuat: { akses_default: number, draft_master: boolean },
//           warnings: [{ kode: 'akses_default' | 'draft_master', pesan }] }
export async function lengkapiSetupKaryawan(admin, emp, { baru = false, kebijakanCuti } = {}) {
  const akses = await pastikanAksesDefault(admin, emp, baru);
  const master = await pastikanDraftMaster(admin, emp, baru, kebijakanCuti);

  const warnings = [];
  if (!akses.ok) warnings.push({ kode: 'akses_default', pesan: PESAN_SETUP_GAGAL.akses_default });
  if (!master.ok) warnings.push({ kode: 'draft_master', pesan: PESAN_SETUP_GAGAL.draft_master });

  return {
    dibuat: { akses_default: akses.dibuat, draft_master: master.dibuat },
    warnings,
  };
}
