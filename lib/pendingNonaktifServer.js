// SERVER ONLY — pengajuan PENDING milik karyawan nonaktif.
//
// Saat karyawan dinonaktifkan, pengajuannya yang masih pending tidak otomatis
// hilang. Berkas ini menjadi sumber tunggal untuk:
//   1. daftar id karyawan nonaktif — dipakai badge dashboard, Inbox Persetujuan,
//      dan pengingat tertunda untuk MENYARING pengajuan mereka
//      (applyPendingFilters({ nonaktifIds }) di lib/pendingQueue.js);
//   2. ringkasan jumlah pengajuan nonaktif per jenis (banner di Inbox);
//   3. penutupan massal (/api/approvals/tutup-nonaktif).
//
// Tidak ada baris yang dihapus. Penutupan hanya mengubah status pending menjadi
// status akhir (lihat tutupNonaktif di PENDING_QUERIES) dan dicatat per baris di
// Activity Log.
//
// admin : client service role dari createAdminClient()
import { fetchAllRows } from '@/lib/fetchAllRows';
import { logActivities } from '@/lib/activityLog';
import {
  PENDING_QUERIES, KOLOM_PEMOHON, CATATAN_TUTUP_NONAKTIF,
} from '@/lib/pendingQueue';

export const AKSI_TUTUP_NONAKTIF = 'tutup_pengajuan_nonaktif';

// Id karyawan nonaktif dipakai dalam filter URL PostgREST. Di atas batas ini
// panjang URL berisiko ditolak proxy, jadi gagal dengan pesan jelas (bukan
// error 414 yang membingungkan). Untuk skala perusahaan ini jauh di atas
// kebutuhan; kalau terlewati, pindahkan filter ke RPC/view di database.
export const MAKS_ID_NONAKTIF = 300;
const ID_CHUNK = 100;

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Id (string) semua karyawan yang BUKAN 'Aktif'. Status kosong (null) dianggap
// nonaktif, sama dengan getSessionEmployee (status !== 'Aktif' ditolak login).
// Melempar error kalau query gagal atau jumlahnya melewati MAKS_ID_NONAKTIF.
export async function muatIdKaryawanNonaktif(admin) {
  const { data, error } = await fetchAllRows(() =>
    admin.from('employees').select('id').or('status.is.null,status.neq.Aktif')
  );
  if (error) throw error;
  const ids = (data || []).map((e) => String(e.id));
  if (ids.length > MAKS_ID_NONAKTIF) {
    throw new Error(
      `Jumlah karyawan nonaktif (${ids.length}) melewati batas filter antrean (${MAKS_ID_NONAKTIF}).`
    );
  }
  return ids;
}

// Query dasar pengajuan PENDING milik sekumpulan pemohon pada satu modul antrean:
// hanya status 'pending' (cuti disetujui yang diminta batal tidak ikut) plus
// filter khusus modul (mis. koreksi absensi mandiri).
function pendingMilik(builder, config, ids) {
  let q = builder.eq('status', 'pending').in(KOLOM_PEMOHON, ids);
  if (config.extra) q = config.extra(q);
  return q;
}

// Ringkasan jumlah pengajuan pending milik karyawan nonaktif per modul.
// keys: modul antrean yang boleh diakses pemanggil. Return
// { rincian: [{ key, jenis, jumlah }], total, gagal: [jenis] } — modul yang gagal
// dibaca masuk `gagal` dan tidak mematikan modul lain. Hanya modul yang punya
// jumlah > 0 masuk `rincian`.
export async function ringkasPengajuanNonaktif(admin, keys, nonaktifIds) {
  if (nonaktifIds.length === 0) return { rincian: [], total: 0, gagal: [] };

  const hasil = await Promise.all(
    keys.map(async (key) => {
      const config = PENDING_QUERIES[key];
      if (!config?.tutupNonaktif) return { key, config, jumlah: 0 };
      let jumlah = 0;
      for (const ids of chunk(nonaktifIds, ID_CHUNK)) {
        const { count, error } = await pendingMilik(
          admin.from(config.table).select('id', { count: 'exact', head: true }),
          config,
          ids
        );
        if (error) {
          console.error(`Hitung pengajuan nonaktif ${key} error:`, error);
          return { key, config, error: true };
        }
        jumlah += count || 0;
      }
      return { key, config, jumlah };
    })
  );

  const rincian = hasil
    .filter((r) => !r.error && r.jumlah > 0)
    .map((r) => ({ key: r.key, jenis: r.config.jenis, jumlah: r.jumlah }));
  return {
    rincian,
    total: rincian.reduce((n, r) => n + r.jumlah, 0),
    gagal: hasil.filter((r) => r.error).map((r) => r.config.jenis),
  };
}

// Tutup massal pengajuan pending milik karyawan nonaktif pada modul `keys`.
// Update bersyarat (.eq('status','pending')) per kelompok pemohon, jadi pengajuan
// yang baru saja diputuskan pihak lain tidak tertimpa. Tiap baris yang ditutup
// dicatat di Activity Log. Return { rincian: [{ key, jenis, jumlah }], total,
// gagal: [jenis] }.
export async function tutupPengajuanNonaktif(admin, { approverId, keys, nonaktifIds }) {
  const nowIso = new Date().toISOString();
  const rincian = [];
  const gagal = [];
  const logs = [];

  for (const key of keys) {
    const config = PENDING_QUERIES[key];
    if (!config?.tutupNonaktif) continue;

    const patch = config.tutupNonaktif(nowIso, approverId, CATATAN_TUTUP_NONAKTIF);
    let jumlah = 0;
    let gagalModul = false;

    for (const ids of chunk(nonaktifIds, ID_CHUNK)) {
      const { data, error } = await pendingMilik(
        admin.from(config.table).update(patch),
        config,
        ids
      ).select(`id, ${KOLOM_PEMOHON}`);

      if (error) {
        console.error(`Tutup pengajuan nonaktif ${key} error:`, error);
        gagalModul = true;
        break;
      }
      for (const row of data || []) {
        jumlah += 1;
        logs.push({
          userId: approverId,
          aksi: AKSI_TUTUP_NONAKTIF,
          targetTable: config.table,
          targetId: row.id,
          detail: {
            employee_id: row[KOLOM_PEMOHON],
            modul: key,
            status_sebelum: 'pending',
            status_sesudah: patch.status,
            catatan: CATATAN_TUTUP_NONAKTIF,
          },
        });
      }
    }

    if (jumlah > 0) rincian.push({ key, jenis: config.jenis, jumlah });
    if (gagalModul) gagal.push(config.jenis);
  }

  await logActivities(admin, logs);
  return { rincian, total: rincian.reduce((n, r) => n + r.jumlah, 0), gagal };
}
