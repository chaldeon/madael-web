// Migrasi SATU KALI: foto clock in/out lama di Supabase Storage (bucket
// `attendance-photos`) -> Google Drive (Shared Drive "Absensi"), supaya sejalan
// dengan foto baru yang sejak fitur "foto ke Drive" langsung diunggah ke Drive
// (lihat app/api/attendance/foto/route.js dan lib/attendancePhotoUrl.js).
//
// AMAN DIJALANKAN BERULANG (idempotent): kolom yang sudah 'drive:...' dilewati,
// jadi run yang terhenti di tengah jalan (error jaringan, dsb.) tinggal diulang.
//
// CARA PAKAI (jalankan dari root proyek):
//
//   node --env-file=.env.local scripts/migrate-attendance-photos-to-drive.mjs
//       DRY RUN: hanya menghitung & menampilkan berapa foto yang akan dimigrasi.
//       TIDAK mengubah apa pun (tidak upload, tidak update DB, tidak hapus).
//
//   node --env-file=.env.local scripts/migrate-attendance-photos-to-drive.mjs --apply
//       Migrasi sungguhan: download dari Supabase -> upload ke Drive -> update
//       attendance.foto_clock_in_url/foto_clock_out_url jadi 'drive:<fileId>'.
//       Foto ASLI di Supabase Storage TIDAK dihapus.
//
//   node --env-file=.env.local scripts/migrate-attendance-photos-to-drive.mjs --apply --delete-source --yes
//       Sama seperti di atas, TAPI begitu satu foto berhasil dipindah dan baris DB-nya
//       berhasil diupdate, foto ASLI-nya langsung dihapus dari Supabase Storage.
//       --yes wajib disertakan (konfirmasi eksplisit, ini penghapusan permanen).
//       SARAN: jalankan dulu --apply saja, cek beberapa foto tampil benar di rekap
//       admin, baru jalankan lagi dengan --delete-source (baris yang sudah 'drive:'
//       otomatis dilewati, jadi aman dipanggil dua kali seperti ini).
//
// Opsional: --batch-size=200 (default 200, jumlah baris attendance per halaman query)
//
// PERSYARATAN ENV VAR (sama seperti aplikasi):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_SHARED_DRIVE_ID_ABSENSI

import { createClient } from '@supabase/supabase-js';
import { uploadAttendancePhotoToDrive } from '../lib/googleDrive.js';
import { jamJakarta } from '../lib/serverTime.js';

const APPLY = process.argv.includes('--apply');
const DELETE_SOURCE = process.argv.includes('--delete-source');
const CONFIRMED = process.argv.includes('--yes');
const BATCH_SIZE = Number(process.argv.find((a) => a.startsWith('--batch-size='))?.split('=')[1]) || 200;
const BUCKET = 'attendance-photos';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset.');
  console.error('Jalankan dengan: node --env-file=.env.local scripts/migrate-attendance-photos-to-drive.mjs');
  process.exit(1);
}
if (DELETE_SOURCE && !APPLY) {
  console.error('--delete-source hanya boleh dipakai bersama --apply.');
  process.exit(1);
}
if (DELETE_SOURCE && !CONFIRMED) {
  console.error('--delete-source menghapus foto asli secara PERMANEN dari Supabase Storage.');
  console.error('Tambahkan --yes untuk konfirmasi kalau ini memang yang dimaksud.');
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function isLegacyPath(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('drive:');
}

// Path lama: '<empId>/<tanggal>-<in|out>-<epochMs>.jpg'. epochMs dipakai supaya foto
// yang dimigrasi punya nama file berjam sungguhan, bukan cuma penanda "migrated".
function jamDariPathLama(path) {
  const m = /-(\d{10,})\.jpg$/i.exec(path);
  const epoch = m ? Number(m[1]) : NaN;
  return Number.isFinite(epoch) ? jamJakarta(new Date(epoch)).replace(/:/g, '') : 'waktu-tidak-diketahui';
}

async function ambilPetaNamaKaryawan() {
  const { data, error } = await supabase.from('employees').select('id, nama');
  if (error) throw error;
  return new Map((data || []).map((e) => [e.id, e.nama || 'Tanpa Nama']));
}

// Baris attendance yang punya foto di salah satu kolom, berhalaman (tidak menarik
// seluruh tabel sekaligus). Baris yang keduanya sudah 'drive:' tetap ikut kebawa di
// sini (query tidak membedakan lama/baru); pemfilteran legacy terjadi per-kolom di bawah.
async function* iterBarisBerhalaman() {
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('attendance')
      .select('id, employee_id, tanggal, foto_clock_in_url, foto_clock_out_url')
      .or('foto_clock_in_url.not.is.null,foto_clock_out_url.not.is.null')
      .order('id', { ascending: true })
      .range(from, from + BATCH_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) return;
    yield data;
    if (data.length < BATCH_SIZE) return;
    from += BATCH_SIZE;
  }
}

async function migrasiSatuFoto({ row, kolom, mode, namaKaryawan }) {
  const pathLama = row[kolom];
  const { data: blob, error: dlError } = await supabase.storage.from(BUCKET).download(pathLama);
  if (dlError) return { status: 'gagal_download', error: dlError.message };

  const buffer = Buffer.from(await blob.arrayBuffer());
  const employeeFolderName = `${namaKaryawan} (${String(row.employee_id).slice(0, 8)})`;
  const monthFolderName = row.tanggal.slice(0, 7);
  const fileName = `${row.tanggal}_${mode}_${jamDariPathLama(pathLama)}.jpg`;

  let uploaded;
  try {
    uploaded = await uploadAttendancePhotoToDrive(buffer, fileName, blob.type || 'image/jpeg', employeeFolderName, monthFolderName);
  } catch (err) {
    return { status: 'gagal_upload_drive', error: err.message };
  }

  const driveRef = `drive:${uploaded.fileId}`;
  // Update bersyarat: hanya menimpa kalau kolomnya masih path lama yang sama persis
  // seperti saat dibaca — mencegah menimpa perubahan lain yang menyelip di tengah migrasi.
  const { data: updated, error: updError } = await supabase
    .from('attendance')
    .update({ [kolom]: driveRef })
    .eq('id', row.id)
    .eq(kolom, pathLama)
    .select('id')
    .maybeSingle();
  if (updError) return { status: 'gagal_update_db', error: updError.message, fileId: uploaded.fileId };
  if (!updated) {
    return { status: 'gagal_update_db', error: 'baris berubah di tengah migrasi (aman diulang, dilewati kali ini)', fileId: uploaded.fileId };
  }

  if (DELETE_SOURCE) {
    // Sumber cuma dihapus SETELAH DB benar-benar sudah menunjuk ke Drive (baris di atas),
    // supaya kegagalan hapus tidak pernah membuat foto hilang tanpa salinan di Drive.
    const { error: rmError } = await supabase.storage.from(BUCKET).remove([pathLama]);
    if (rmError) return { status: 'sukses_gagal_hapus_sumber', error: rmError.message, driveRef, pathLama };
  }

  return { status: 'sukses', driveRef, pathLama };
}

async function main() {
  const namaMap = await ambilPetaNamaKaryawan();
  const ringkasan = {};
  const catat = (status) => { ringkasan[status] = (ringkasan[status] || 0) + 1; };
  const gagalDetail = [];
  let totalDicek = 0;

  for await (const halaman of iterBarisBerhalaman()) {
    for (const row of halaman) {
      for (const [kolom, mode] of [['foto_clock_in_url', 'in'], ['foto_clock_out_url', 'out']]) {
        const nilai = row[kolom];
        if (!nilai) continue;
        totalDicek += 1;
        if (!isLegacyPath(nilai)) { catat('dilewati_sudah_migrasi'); continue; }

        if (!APPLY) { catat('akan_dimigrasi'); continue; } // dry run

        const hasil = await migrasiSatuFoto({ row, kolom, mode, namaKaryawan: namaMap.get(row.employee_id) || 'Tanpa Nama' });
        catat(hasil.status);
        if (hasil.status !== 'sukses') gagalDetail.push({ attendanceId: row.id, kolom, pathLama: nilai, ...hasil });
      }
    }
    process.stdout.write('.');
  }

  console.log(`\n\nTotal foto diperiksa: ${totalDicek}`);
  console.log(APPLY ? 'Hasil:' : 'Perkiraan (DRY RUN — belum ada perubahan):', ringkasan);

  if (gagalDetail.length > 0) {
    console.log(`\n${gagalDetail.length} foto perlu perhatian (aman dijalankan ulang):`);
    gagalDetail.slice(0, 20).forEach((g) => console.log(`  - attendance#${g.attendanceId} ${g.kolom}: ${g.status} — ${g.error}`));
    if (gagalDetail.length > 20) console.log(`  ... dan ${gagalDetail.length - 20} lainnya.`);
  }
  if (!APPLY) console.log('\nIni baru simulasi. Jalankan lagi dengan --apply untuk migrasi sungguhan.');
}

await main();
