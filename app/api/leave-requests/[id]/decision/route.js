import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployee } from '@/lib/notify';
import { hitungHariKerja, tahunSekarang, tahunDariTanggal, potongKuota, labelJenisCuti } from '@/lib/leave';
import { ambilKonteksCuti, cariCutiBentrok, formatTanggal, ubahKuotaTerpakai } from '@/lib/leaveServer';

// POST /api/leave-requests/[id]/decision   body: { decision }
//   'approved'  : pending  -> approved  (kuota berkurang)
//   'rejected'  : pending  -> rejected
//   'cancelled' : approved -> cancelled (admin membatalkan cuti yang sudah
//                 disetujui; kuota dikembalikan)
//
// Jenis sakit/izin tidak memotong kuota: approve/cancel hanya mengubah status
// (lihat JENIS_CUTI di lib/leave.js). Hanya jenis yang memotong kuota
// (tahunan) yang menyentuh employees_master.
//
// Hanya superadmin aktif. Dulu approve dilakukan dari browser dengan dua
// UPDATE terpisah (status, lalu kuota) tanpa cek sisa kuota. Di sini kuota
// diubah lebih dulu lewat compare-and-swap, baru status; kalau langkah kedua
// gagal, kuota dikembalikan — jadi salah satu berhasil keduanya atau tidak
// sama sekali.
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const session = await getSessionEmployee('id, nama, status, is_superadmin');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { emp } = session;
    if (!emp.is_superadmin) {
      return NextResponse.json({ error: 'Hanya superadmin yang boleh memproses pengajuan cuti.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const decision = body?.decision;
    if (!['approved', 'rejected', 'cancelled'].includes(decision)) {
      return NextResponse.json({ error: 'Keputusan tidak valid.' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: row, error: rowError } = await admin
      .from('leave_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (rowError) {
      return NextResponse.json({ error: `Gagal memuat pengajuan: ${rowError.message}` }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: 'Pengajuan cuti tidak ditemukan.' }, { status: 404 });
    }

    const statusAwal = decision === 'cancelled' ? 'approved' : 'pending';
    if (row.status !== statusAwal) {
      return NextResponse.json(
        {
          error: decision === 'cancelled'
            ? 'Hanya pengajuan yang sudah disetujui yang bisa dibatalkan.'
            : 'Pengajuan ini sudah tidak berstatus menunggu (mungkin dibatalkan karyawan atau sudah diproses). Daftar dimuat ulang.',
          status: row.status,
        },
        { status: 409 }
      );
    }

    const ctx = await ambilKonteksCuti(admin, row.employee_id);
    if (ctx.error) {
      return NextResponse.json({ error: `Gagal memuat data cuti: ${ctx.error.message}` }, { status: 500 });
    }

    const potong = potongKuota(row.jenis);
    const tahun = tahunSekarang();
    const hariDariJadwal = hitungHariKerja(row.tanggal_mulai, row.tanggal_selesai, ctx.hariKerja);
    const sekarang = new Date().toISOString();
    let warning = null;
    let kuota = null;

    // Update status bersyarat: hanya kalau status di DB masih statusAwal.
    const updateStatus = (patch) =>
      admin
        .from('leave_requests')
        .update({ ...patch, updated_at: sekarang })
        .eq('id', id)
        .eq('status', statusAwal)
        .select()
        .maybeSingle();

    const kembalikanKuota = (delta) =>
      ctx.master ? ubahKuotaTerpakai(admin, ctx.master.id, tahun, delta) : Promise.resolve(null);

    let hasil; // { data, error } dari update status
    let jumlahHari = hariDariJadwal;

    if (decision === 'rejected') {
      hasil = await updateStatus({ status: 'rejected', approved_by: emp.id });
    } else if (decision === 'approved') {
      if (tahunDariTanggal(row.tanggal_mulai) !== tahun || tahunDariTanggal(row.tanggal_selesai) !== tahun) {
        return NextResponse.json(
          { error: `Pengajuan di luar tahun ${tahun} atau lintas tahun tidak bisa disetujui karena kuota hanya dilacak per tahun berjalan. Tolak, lalu minta karyawan mengajukan ulang.` },
          { status: 400 }
        );
      }
      if (hariDariJadwal === 0) {
        return NextResponse.json(
          { error: 'Rentang tanggal ini tidak mengandung hari kerja menurut jadwal karyawan. Tolak pengajuan ini.' },
          { status: 400 }
        );
      }

      const { error: bentrokError, bentrok } = await cariCutiBentrok(admin, {
        employeeId: row.employee_id,
        tanggalMulai: row.tanggal_mulai,
        tanggalSelesai: row.tanggal_selesai,
        excludeId: id,
        statuses: ['approved'],
      });
      if (bentrokError) {
        return NextResponse.json({ error: `Gagal memeriksa pengajuan lain: ${bentrokError.message}` }, { status: 500 });
      }
      if (bentrok) {
        return NextResponse.json(
          { error: `Bentrok dengan cuti yang sudah disetujui (${formatTanggal(bentrok.tanggal_mulai)} – ${formatTanggal(bentrok.tanggal_selesai)}).` },
          { status: 409 }
        );
      }

      if (!potong) {
        // sakit/izin: tidak ada potongan kuota
      } else if (ctx.master) {
        const q = await ubahKuotaTerpakai(admin, ctx.master.id, tahun, jumlahHari, { batasiJatah: true });
        if (!q.ok) {
          if (q.reason === 'kuota') {
            return NextResponse.json(
              { error: `Sisa kuota tidak cukup: butuh ${jumlahHari} hari, sisa ${q.sisa} dari ${q.jatah} hari. Naikkan jatah di Payroll Manager atau tolak pengajuan ini.` },
              { status: 409 }
            );
          }
          if (q.reason === 'konflik') {
            return NextResponse.json({ error: 'Kuota sedang diubah proses lain. Coba lagi.' }, { status: 409 });
          }
          return NextResponse.json({ error: `Gagal memperbarui kuota: ${q.message}` }, { status: 500 });
        }
        kuota = { master_id: ctx.master.id, cuti_terpakai: q.terpakai, cuti_terpakai_tahun: q.tahun };
      } else {
        warning = 'Cuti disetujui. Karyawan ini belum terhubung ke data master (Payroll), sisa kuota tidak diperbarui.';
      }

      hasil = await updateStatus({ status: 'approved', approved_by: emp.id, jumlah_hari: jumlahHari });

      // Status gagal berubah (kalah balapan / error) -> batalkan potongan kuota.
      if (potong && (hasil.error || !hasil.data)) {
        await kembalikanKuota(-jumlahHari);
        kuota = null;
      }
    } else {
      // approved -> cancelled. Pakai jumlah hari yang dipotong saat approve
      // (kolom jumlah_hari); baris lama tanpa kolom itu dihitung ulang dari
      // jadwal kerja saat ini.
      jumlahHari = Number.isInteger(row.jumlah_hari) ? row.jumlah_hari : hariDariJadwal;
      const tahunSama =
        tahunDariTanggal(row.tanggal_mulai) === tahun && tahunDariTanggal(row.tanggal_selesai) === tahun;

      let sudahKembali = false;
      if (potong && ctx.master && tahunSama && jumlahHari > 0) {
        const q = await ubahKuotaTerpakai(admin, ctx.master.id, tahun, -jumlahHari);
        if (!q.ok) {
          const pesan = q.reason === 'konflik' ? 'Kuota sedang diubah proses lain. Coba lagi.' : `Gagal mengembalikan kuota: ${q.message}`;
          return NextResponse.json({ error: pesan }, { status: q.reason === 'konflik' ? 409 : 500 });
        }
        kuota = { master_id: ctx.master.id, cuti_terpakai: q.terpakai, cuti_terpakai_tahun: q.tahun };
        sudahKembali = true;
      } else if (potong && !ctx.master) {
        warning = 'Cuti dibatalkan. Karyawan ini belum terhubung ke data master (Payroll), kuota tidak diubah.';
      } else if (potong && !tahunSama) {
        warning = `Cuti dibatalkan, tetapi kuota tidak dikembalikan karena cuti ini bukan di tahun ${tahun} (kuota hanya dilacak untuk tahun berjalan).`;
      }

      hasil = await updateStatus({ status: 'cancelled' });

      if ((hasil.error || !hasil.data) && sudahKembali) {
        await kembalikanKuota(jumlahHari);
        kuota = null;
      }
    }

    if (hasil.error) {
      console.error('Proses cuti error:', hasil.error);
      return NextResponse.json({ error: `Gagal memperbarui status pengajuan: ${hasil.error.message}` }, { status: 500 });
    }
    if (!hasil.data) {
      return NextResponse.json(
        { error: 'Pengajuan ini baru saja diproses pihak lain. Daftar dimuat ulang.' },
        { status: 409 }
      );
    }

    const aksi = { approved: 'approve_cuti', rejected: 'reject_cuti', cancelled: 'revoke_cuti' }[decision];
    await logActivity(admin, {
      userId: emp.id,
      aksi,
      targetTable: 'leave_requests',
      targetId: row.id,
      detail: {
        employee_id: row.employee_id,
        tanggal_mulai: row.tanggal_mulai,
        tanggal_selesai: row.tanggal_selesai,
        jenis: row.jenis || 'tahunan',
        jumlah_hari_kerja: jumlahHari,
        kuota_terpakai_setelah: kuota ? kuota.cuti_terpakai : null,
      },
    });

    const label = { approved: 'disetujui', rejected: 'ditolak', cancelled: 'dibatalkan oleh admin' }[decision];
    await notifyEmployee(admin, {
      userId: row.employee_id,
      tipe: decision === 'cancelled' ? 'cuti_cancelled' : `cuti_${decision}`,
      pesan: `Pengajuan ${potong ? 'cuti' : labelJenisCuti(row.jenis).toLowerCase()} kamu (${formatTanggal(row.tanggal_mulai)} – ${formatTanggal(row.tanggal_selesai)}, ${jumlahHari} hari kerja) telah ${label}.`,
      link: '/employee/leave-request',
    });

    return NextResponse.json({ success: true, request: hasil.data, kuota, warning });
  } catch (err) {
    console.error('Proses cuti error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
