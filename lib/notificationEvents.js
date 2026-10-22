// SERVER ONLY — katalog event notifikasi yang boleh dipicu dari browser lewat
// /api/notifications/dispatch.
//
// Browser hanya mengirim { event, id }. Isi notifikasi (penerima, tipe, pesan,
// link) disusun di sini dari data asli di database, bukan dari body request:
//   - penerima ditentukan server (superadmin / pemilik record / semua aktif);
//   - pesan dirangkai dari isi record, bukan teks bebas dari browser;
//   - link selalu path tetap milik event ini;
//   - record harus benar-benar dalam keadaan yang memicu event itu (mis.
//     pengajuan milik si pengirim dan masih pending), jadi event tidak bisa
//     dipakai untuk menyebar notifikasi karangan.
//
// Tiap event: { needs, build }. `needs` = modul yang berwenang memicu event
// (superadmin lolos kecuali modul EXPLICIT_ONLY). `build({ admin, emp, id })`
// mengembalikan { to, tipe, pesan, link } atau null kalau record tidak valid.
//   to: 'superadmins' | 'all_active' | { module: '<key>' } | { userId } | { userIds: [...] }
//   { module } = semua pemegang modul tsb + superadmin (notifyByModule).
//   Pakai 'superadmins' hanya untuk modul superadminOnly (mis. absensi_admin).
import { fieldLabel } from '@/lib/profileFields';
import { periodeLabel } from '@/lib/payrollRunConfig';
import { formatRupiah } from '@/lib/format';

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

export const NOTIFICATION_EVENTS = {
  // ── Diajukan karyawan → pemegang modul admin (+ superadmin) ─────────────
  koreksi_absensi_diajukan: {
    needs: ['absensi'],
    async build({ admin, emp, id }) {
      const { data: row } = await admin
        .from('attendance_corrections')
        .select('tanggal, employee_id, status')
        .eq('id', id)
        .maybeSingle();
      if (!row || row.employee_id !== emp.id || row.status !== 'pending') return null;
      // absensi_admin superadminOnly, jadi memang hanya superadmin.
      return {
        to: 'superadmins',
        tipe: 'koreksi_absensi_diajukan',
        pesan: `${emp.nama || 'Karyawan'} mengajukan koreksi absensi tanggal ${formatTanggal(row.tanggal)}.`,
        link: '/employee/absensi/karyawan',
      };
    },
  },

  profil_diajukan: {
    needs: ['profile'],
    async build({ admin, emp, id }) {
      const { data: row } = await admin
        .from('profile_change_requests')
        .select('employee_id, field_changes, status')
        .eq('id', id)
        .maybeSingle();
      if (!row || row.employee_id !== emp.id || row.status !== 'pending') return null;
      const fields = Object.keys(row.field_changes || {}).map(fieldLabel).join(', ');
      return {
        to: { module: 'profile_admin' },
        tipe: 'profil_diajukan',
        pesan: `${emp.nama || 'Karyawan'} mengajukan perubahan profil (${fields}).`,
        link: '/employee/profile/admin',
      };
    },
  },

  reimbursement_diajukan: {
    needs: ['reimbursement'],
    async build({ admin, emp, id }) {
      const { data: row } = await admin
        .from('reimbursement_requests')
        .select('employee_id, kategori, jumlah, status')
        .eq('id', id)
        .maybeSingle();
      if (!row || row.employee_id !== emp.id || row.status !== 'pending') return null;
      return {
        to: { module: 'reimbursement_admin' },
        tipe: 'reimbursement_diajukan',
        pesan: `${emp.nama || 'Karyawan'} mengajukan klaim reimbursement ${formatRupiah(row.jumlah)} (${row.kategori}).`,
        link: '/employee/reimbursement/admin',
      };
    },
  },

  // ── Keputusan admin → karyawan ──────────────────────────────────────────
  koreksi_absensi_ditolak: {
    needs: ['absensi_admin'],
    async build({ admin, emp, id }) {
      const { data: row } = await admin
        .from('attendance_corrections')
        .select('tanggal, employee_id, status, reviewed_by, catatan_reviewer')
        .eq('id', id)
        .maybeSingle();
      if (!row || row.status !== 'rejected' || row.reviewed_by !== emp.id) return null;
      const catatan = (row.catatan_reviewer || '').trim();
      return {
        to: { userId: row.employee_id },
        tipe: 'koreksi_absensi_ditolak',
        pesan: `Pengajuan koreksi absensi tanggal ${formatTanggal(row.tanggal)} ditolak.${catatan ? ` Alasan: ${catatan}` : ''}`,
        link: '/employee/absensi',
      };
    },
  },

  payslip_published: {
    needs: ['payslip_admin'],
    async build({ admin, id }) {
      const { data: row } = await admin
        .from('payslips')
        .select('employee_id, periode, periode_label, is_published')
        .eq('id', id)
        .maybeSingle();
      if (!row || !row.is_published) return null;
      return {
        to: { userId: row.employee_id },
        tipe: 'payslip_published',
        pesan: `Slip gaji periode ${row.periode_label || row.periode} sudah bisa dilihat.`,
        link: '/employee/payslip',
      };
    },
  },

  payroll_approved: {
    needs: ['payroll'],
    async build({ admin, id }) {
      const { data: run } = await admin
        .from('payroll_runs')
        .select('periode, status')
        .eq('id', id)
        .maybeSingle();
      if (!run || run.status !== 'Approved') return null;

      const { data: items } = await admin
        .from('payroll_run_items')
        .select('employees_master ( linked_employee_id )')
        .eq('payroll_run_id', id);
      const userIds = (items || [])
        .map((i) => i.employees_master?.linked_employee_id)
        .filter(Boolean);

      return {
        to: { userIds },
        tipe: 'payroll_approved',
        pesan: `Payslip periode ${periodeLabel(run.periode)} sudah disetujui dan bisa dilihat.`,
        link: '/employee/payslip',
      };
    },
  },

  // ── Broadcast ───────────────────────────────────────────────────────────
  pengumuman_baru: {
    needs: ['announcements_admin'],
    async build({ admin, id }) {
      const { data: row } = await admin
        .from('announcements')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!row || row.is_active === false) return null;

      // Pengumuman untuk semua karyawan aktif.
      if (!row.target_company_id) {
        return {
          to: 'all_active',
          tipe: 'pengumuman_baru',
          pesan: `Pengumuman baru: ${row.judul}`,
          link: '/employee/dashboard',
        };
      }

      // Pengumuman bertarget: hanya karyawan aktif di perusahaan itu. Nama
      // perusahaan masuk ke pesan supaya pengumuman berjudul sama untuk dua
      // perusahaan tidak dianggap duplikat oleh anti-duplikat dispatch.
      const [{ data: company }, { data: emps }] = await Promise.all([
        admin.from('companies').select('nama_perusahaan').eq('id', row.target_company_id).maybeSingle(),
        admin.from('employees').select('id').eq('status', 'Aktif').eq('client_id', row.target_company_id),
      ]);
      return {
        to: { userIds: (emps || []).map((e) => e.id) },
        tipe: 'pengumuman_baru',
        pesan: `Pengumuman baru${company?.nama_perusahaan ? ` (${company.nama_perusahaan})` : ''}: ${row.judul}`,
        link: '/employee/dashboard',
      };
    },
  },
};

export const MAKS_PESAN = 500;
// Event identik (tipe + pesan sama) dalam jendela ini dianggap duplikat dan
// diabaikan — mencegah dispatch berulang dibanjiri ke inbox orang lain.
export const JENDELA_DUPLIKAT_MS = 10 * 60 * 1000;
