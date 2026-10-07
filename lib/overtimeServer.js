// Helper server-only untuk modul Lembur (dipakai route di app/api/overtime-requests).
// Semua fungsi menerima client service role (createAdminClient) — jangan
// import file ini dari komponen client.
import {
  tambahHari, rentangMingguan, intervalMenit, intervalBentrok, menitEfektif,
  MAX_JAM_LEMBUR_HARIAN, MAX_JAM_LEMBUR_MINGGUAN,
} from '@/lib/overtimeRules';
import { formatTanggal } from '@/lib/leaveServer';

function jamTeks(menit) {
  return String(Number((menit / 60).toFixed(2))).replace('.', ',');
}

// Jadwal kerja (array nama hari) satu karyawan; null kalau belum ada jadwal.
export async function ambilHariKerja(admin, employeeId) {
  const { data, error } = await admin
    .from('work_schedule')
    .select('hari_kerja')
    .eq('employee_id', employeeId)
    .maybeSingle();
  return { error, hariKerja: data?.hari_kerja || null };
}

// Cek pengajuan baru terhadap pengajuan pending/approved milik karyawan yang
// sama: (1) jam tidak boleh bentrok (lembur melewati tengah malam ikut
// diperhitungkan, jadi tanggal sehari sebelum/sesudahnya ikut dibaca);
// (2) untuk hari kerja biasa, total harian dan mingguan (Senin–Minggu) tidak
// boleh melewati batas PP 35/2021.
//
// Return null kalau lolos, atau { status, message } untuk dikirim sebagai JSON.
export async function periksaPengajuanLembur(admin, { employeeId, tanggal, jamMulai, durasiMenit, jenisHari }) {
  const { senin, minggu } = rentangMingguan(tanggal);
  const dari = [tambahHari(tanggal, -1), senin].sort()[0];
  const sampai = [tambahHari(tanggal, 1), minggu].sort().at(-1);

  const { data, error } = await admin
    .from('overtime_requests')
    .select('id, tanggal, jam_mulai, durasi_menit, jenis_hari, status, jam_disetujui')
    .eq('employee_id', employeeId)
    .in('status', ['pending', 'approved'])
    .gte('tanggal', dari)
    .lte('tanggal', sampai);
  if (error) {
    console.error('Cek pengajuan lembur error:', error);
    return { status: 500, message: 'Gagal memeriksa pengajuan lembur lain. Coba lagi.' };
  }
  const rows = data || [];

  const baru = intervalMenit({ tanggal, jam_mulai: jamMulai, durasi_menit: durasiMenit }, tanggal);
  const bentrok = rows.find((r) => intervalBentrok(baru, intervalMenit(r, tanggal)));
  if (bentrok) {
    return {
      status: 409,
      message: `Jam lembur bentrok dengan pengajuan lain yang ${bentrok.status === 'approved' ? 'sudah disetujui' : 'masih menunggu'} (${formatTanggal(bentrok.tanggal)}, mulai ${bentrok.jam_mulai.slice(0, 5)}, ${bentrok.durasi_menit} menit).`,
    };
  }

  if (jenisHari === 'biasa') {
    const biasa = rows.filter((r) => r.jenis_hari === 'biasa');

    const menitHariItu = biasa
      .filter((r) => r.tanggal === tanggal)
      .reduce((sum, r) => sum + menitEfektif(r), 0) + durasiMenit;
    if (menitHariItu > MAX_JAM_LEMBUR_HARIAN * 60) {
      return {
        status: 400,
        message: `Lembur di hari kerja biasa maksimal ${MAX_JAM_LEMBUR_HARIAN} jam per hari (PP 35/2021). Dengan pengajuan ini totalnya menjadi ${jamTeks(menitHariItu)} jam.`,
      };
    }

    const menitMinggu = biasa
      .filter((r) => r.tanggal >= senin && r.tanggal <= minggu)
      .reduce((sum, r) => sum + menitEfektif(r), 0) + durasiMenit;
    if (menitMinggu > MAX_JAM_LEMBUR_MINGGUAN * 60) {
      return {
        status: 400,
        message: `Lembur di hari kerja biasa maksimal ${MAX_JAM_LEMBUR_MINGGUAN} jam per minggu (PP 35/2021). Dengan pengajuan ini totalnya minggu itu menjadi ${jamTeks(menitMinggu)} jam.`,
      };
    }
  }

  return null;
}
