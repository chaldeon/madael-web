// Definisi antrean persetujuan lintas modul — SATU sumber untuk badge dashboard
// (/api/dashboard/pending-counts) dan Inbox Persetujuan (/api/approvals/inbox),
// supaya angka badge dan isi inbox selalu memakai filter yang sama.
//
// Kuncinya = key modul di MODULE_REGISTRY (flag pendingQueue). Berkas ini murni
// (tanpa import khusus-server), tapi hanya dipakai route server karena query-nya
// berjalan dengan service role.
//
// table     : tabel pengajuan (kolom status = 'pending' berarti menunggu)
// ownColumn : kolom pemilik pengajuan. Pengajuan milik approver sendiri tidak
//             ditampilkan/dihitung karena route keputusannya menolak
//             memprosesnya (lihat SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN di
//             lib/leave.js), jadi antrean tidak menjanjikan hal yang tidak bisa
//             dikerjakan.
// extra     : filter tambahan pada query builder
// jenis     : label jenis pengajuan untuk tampilan inbox
// select    : kolom tambahan yang dibaca untuk baris inbox (id, employee_id
//             sebagai pemohon, dan created_at selalu ikut dibaca)
// antrean   : (query) => query, pengganti filter dasar status = 'pending' untuk
//             modul yang antreannya juga memuat jenis baris lain (cuti: permintaan
//             batal dari karyawan atas cuti yang sudah disetujui). Pengingat
//             pengajuan tertunda tidak memakainya (lihat untukPengingat).
// jenisItem : (row) => string | null, label jenis per baris inbox bila berbeda
//             dari `jenis` modul (null = pakai `jenis`)
// diajukanDari : (row) => ISO string | null, waktu "diajukan" per baris inbox
//             bila bukan created_at (null = pakai created_at)
// tinjauQuery : (row) => string, query string yang ditambahkan ke tautan
//             "Tinjau" baris itu (mis. '?status=minta_batal'); '' = tanpa
// aksiLangsung : (row) => boolean, false = baris hanya bisa dibuka lewat
//             "Tinjau" (tanpa tombol Setujui/Tolak/checkbox massal di inbox)
// ringkas   : (row) => string, ringkasan satu baris. HANYA memuat info umum
//             (tanggal, jenis, nominal); data sensitif tidak ikut dikirim —
//             detail dibuka di halaman keputusan modul masing-masing.
// tutupNonaktif : (nowIso, approverId, catatan) => objek kolom yang diubah saat
//             pengajuan PENDING milik karyawan nonaktif ditutup massal
//             (/api/approvals/tutup-nonaktif). Hanya memuat kolom yang sudah
//             dipakai route pembatalan/keputusan modulnya. Tidak ada data yang
//             dihapus: baris tetap ada dengan status akhir.
//
// Pengajuan milik karyawan NONAKTIF (employees.status != 'Aktif') tidak dihitung
// dan tidak ditampilkan di antrean maupun pengingat — approver tidak perlu
// menimbang pengajuan orang yang sudah keluar. Kolom pemohon di semua tabel di
// bawah adalah employee_id (KOLOM_PEMOHON). Daftar id nonaktif dimuat server
// (lib/pendingNonaktifServer.js) lalu dikirim ke applyPendingFilters.
import { labelJenisCuti } from '@/lib/leave';
import { formatRupiah } from '@/lib/format';
import { labelKategoriReimbursement } from '@/lib/reimbursement';
import { fieldLabel } from '@/lib/profileFields';

function tanggalPendek(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function jamPendek(value) {
  return value ? String(value).slice(0, 5) : '—';
}

function ringkasRentang(mulai, selesai) {
  return mulai === selesai || !selesai
    ? tanggalPendek(mulai)
    : `${tanggalPendek(mulai)} – ${tanggalPendek(selesai)}`;
}

export const PENDING_QUERIES = {
  leave_request_admin: {
    table: 'leave_requests',
    ownColumn: 'employee_id',
    jenis: 'Cuti',
    select: 'jenis, tanggal_mulai, tanggal_selesai, status, minta_batal_at',
    // Pengajuan menunggu persetujuan + cuti disetujui yang diminta batal oleh
    // karyawan dan belum dijawab HR (minta_batal_status = 'menunggu').
    antrean: (q) => q.or('status.eq.pending,and(status.eq.approved,minta_batal_status.eq.menunggu)'),
    // Hanya yang masih 'pending' yang ditutup. Cuti disetujui yang diminta
    // batal tidak disentuh (membatalkannya mengubah kuota — keputusan HR).
    tutupNonaktif: (nowIso) => ({ status: 'cancelled', updated_at: nowIso }),
    jenisItem: (r) => (r.status === 'approved' ? 'Minta Batal Cuti' : null),
    diajukanDari: (r) => (r.status === 'approved' ? r.minta_batal_at : null),
    // Menjawab permintaan batal (setujui = batalkan cuti, tolak = catatan)
    // dilakukan di halaman Kelola Pengajuan Cuti, bukan aksi langsung inbox.
    aksiLangsung: (r) => r.status === 'pending',
    tinjauQuery: (r) => (r.status === 'approved' ? '?status=minta_batal' : ''),
    ringkas: (r) =>
      `${r.status === 'approved' ? 'Minta batal · ' : ''}${labelJenisCuti(r.jenis)} · ${ringkasRentang(r.tanggal_mulai, r.tanggal_selesai)}`,
  },
  overtime_admin: {
    table: 'overtime_requests',
    ownColumn: 'employee_id',
    jenis: 'Lembur',
    select: 'tanggal, jam_mulai, jam_selesai',
    tutupNonaktif: (nowIso) => ({ status: 'cancelled', updated_at: nowIso }),
    ringkas: (r) => `${tanggalPendek(r.tanggal)} · ${jamPendek(r.jam_mulai)}–${jamPendek(r.jam_selesai)}`,
  },
  reimbursement_admin: {
    table: 'reimbursement_requests',
    ownColumn: 'employee_id',
    jenis: 'Reimbursement',
    select: 'kategori, jumlah',
    tutupNonaktif: (nowIso) => ({ status: 'cancelled', updated_at: nowIso }),
    ringkas: (r) => `${labelKategoriReimbursement(r.kategori)} · ${formatRupiah(r.jumlah)}`,
  },
  profile_admin: {
    table: 'profile_change_requests',
    ownColumn: 'employee_id',
    jenis: 'Perubahan Profil',
    select: 'field_changes',
    // Tabel ini tidak punya jalur 'cancelled' di kode, jadi ditutup dengan
    // status 'rejected' + catatan reviewer (kolom yang sama dengan route
    // keputusan profil). Karyawan nonaktif tidak diberi notifikasi.
    tutupNonaktif: (nowIso, approverId, catatan) => ({
      status: 'rejected',
      catatan_reviewer: catatan,
      reviewed_by: approverId,
      reviewed_at: nowIso,
    }),
    // field_changes dikirim karyawan dari browser (JSON bebas): hanya nama
    // field yang ditampilkan, nilainya tidak dikirim ke inbox.
    ringkas: (r) => {
      const fc = r.field_changes;
      const keys = fc && typeof fc === 'object' && !Array.isArray(fc) ? Object.keys(fc) : [];
      return keys.length > 0 ? `Ubah ${keys.map(fieldLabel).join(', ')}` : 'Pengajuan perubahan data';
    },
  },
  // Koreksi absensi: hanya pengajuan mandiri karyawan (requested_by terisi),
  // sama dengan route approve. Route itu tidak punya cek milik-sendiri.
  absensi_admin: {
    table: 'attendance_corrections',
    jenis: 'Koreksi Absensi',
    select: 'tanggal',
    extra: (q) => q.not('requested_by', 'is', null),
    // Sama dengan route pembatalan koreksi oleh karyawan (hanya kolom status).
    tutupNonaktif: () => ({ status: 'cancelled' }),
    ringkas: (r) => `Absensi tanggal ${tanggalPendek(r.tanggal)}`,
  },
};

// Kolom pemilik/pemohon pengajuan — sama di semua tabel PENDING_QUERIES (juga
// yang dibaca inbox sebagai `employee_id`).
export const KOLOM_PEMOHON = 'employee_id';

// Catatan baku saat pengajuan karyawan nonaktif ditutup massal; ikut tersimpan
// di Activity Log dan (untuk Perubahan Profil) di catatan reviewer.
export const CATATAN_TUTUP_NONAKTIF = 'Ditutup massal: pemohon sudah nonaktif.';

// Terapkan filter antrean yang SAMA untuk hitungan badge dan isi inbox:
// status pending (atau config.antrean), bukan pengajuan milik approver sendiri,
// bukan milik karyawan nonaktif, plus filter khusus modul. untukPengingat: true
// = hanya status pending, supaya pengingat "pengajuan tertunda" (dihitung dari
// created_at) tidak ikut menghitung baris antrean lain yang umur menunggunya
// diukur dari kolom berbeda.
//
// nonaktifIds: id karyawan nonaktif (array, boleh kosong/undefined). Disaring
// lewat NOT IN di kolom pemohon, bukan join employees, karena skema FK semua
// tabel pengajuan tidak terverifikasi dari repo. Jumlah karyawan nonaktif kecil
// (puluhan), jadi panjang URL aman.
export function applyPendingFilters(
  query,
  config,
  { empId, excludeOwn, untukPengingat = false, nonaktifIds = [] }
) {
  let q = config.antrean && !untukPengingat ? config.antrean(query) : query.eq('status', 'pending');
  if (config.ownColumn && excludeOwn) q = q.neq(config.ownColumn, empId);
  if (nonaktifIds.length > 0) q = q.not(KOLOM_PEMOHON, 'in', `(${nonaktifIds.join(',')})`);
  if (config.extra) q = config.extra(q);
  return q;
}
