import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getSessionEmployee } from '@/lib/sessionEmployee';
import {
  hitungHariKerja, hitungSisaCuti, tahunSekarang, tahunDariTanggal, tanggalValid, pecahPerTahun,
  JENIS_CUTI_DEFAULT, JENIS_POTONG_KUOTA, jenisCutiValid, labelJenisCuti, potongKuota, lampiranWajib,
  LAMPIRAN_MAKS_BYTES, LAMPIRAN_MIME,
} from '@/lib/leave';
import { ambilKonteksCuti, cariCutiBentrok, formatTanggal } from '@/lib/leaveServer';
import { uploadLeaveAttachmentToDrive, deleteEmployeeDocumentFromDrive } from '@/lib/googleDrive';
import { friendlyError } from '@/lib/errorMessage';
import { notifyByModule } from '@/lib/notify';

const MAKS_ALASAN = 500;

// POST /api/leave-requests
// Karyawan mengajukan cuti. Dulu insert langsung dari browser tanpa validasi
// server; sekarang semua aturan dicek di sini:
// - tanggal valid, selesai >= mulai, alasan terisi (maks 500 karakter)
// - rentang boleh di tahun berjalan dan tahun berikutnya. Kuota di
//   employees_master hanya melacak satu tahun, jadi pengajuan lintas tahun
//   dipecah di sini menjadi satu baris leave_requests per tahun (semua baris
//   di-insert dalam satu perintah, jadi semuanya masuk atau tidak sama sekali).
//   Baris tahun depan baru bisa disetujui mulai 1 Januari tahun itu (lihat
//   decision/route.js); sebelum itu ia menunggu di antrean.
// - minimal 1 hari kerja menurut jadwal employee (bagian tahun yang tidak
//   punya hari kerja tidak dibuatkan baris)
// - tidak bentrok dengan pengajuan lain yang pending/approved
// - tidak melebihi sisa kuota tahun yang bersangkutan (dikurangi pengajuan
//   pending lain di tahun itu) — hanya untuk jenis yang memotong kuota
//   (tahunan); sakit/izin tidak. Sisa kuota tahun depan adalah proyeksi
//   (hitungSaldoCuti menghitung lazy per tahun); angka finalnya dicek ulang
//   saat approve.
// - jenis cuti (tahunan/sakit/izin; kosong = tahunan, kompatibel klien lama)
// - lampiran opsional (PDF/JPG/PNG maks 4MB); wajib untuk jenis tertentu
//   (lihat JENIS_CUTI di lib/leave.js). Body boleh JSON (tanpa lampiran) atau
//   multipart/form-data (dengan field `lampiran`).
// employee_id selalu diambil dari sesi, bukan dari body.
export async function POST(request) {
  try {
    const session = await getSessionEmployee('id, nama, status');
    if (session.error) {
      return NextResponse.json({ error: session.error }, { status: session.status });
    }
    const { emp } = session;

    let body = {};
    let file = null;
    if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
      const formData = await request.formData().catch(() => null);
      if (formData) {
        body = {
          tanggalMulai: formData.get('tanggalMulai'),
          tanggalSelesai: formData.get('tanggalSelesai'),
          alasan: formData.get('alasan'),
          jenis: formData.get('jenis'),
        };
        const f = formData.get('lampiran');
        if (f && typeof f !== 'string' && f.size > 0) file = f;
      }
    } else {
      body = await request.json().catch(() => ({}));
    }
    const tanggalMulai = body?.tanggalMulai;
    const tanggalSelesai = body?.tanggalSelesai;
    const alasan = typeof body?.alasan === 'string' ? body.alasan.trim() : '';
    const jenis = body?.jenis ? String(body.jenis) : JENIS_CUTI_DEFAULT;

    if (!tanggalValid(tanggalMulai) || !tanggalValid(tanggalSelesai)) {
      return NextResponse.json({ error: 'Tanggal mulai dan tanggal selesai wajib diisi dengan benar.' }, { status: 400 });
    }
    if (tanggalSelesai < tanggalMulai) {
      return NextResponse.json({ error: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' }, { status: 400 });
    }
    if (!alasan) {
      return NextResponse.json({ error: 'Alasan cuti wajib diisi.' }, { status: 400 });
    }
    if (alasan.length > MAKS_ALASAN) {
      return NextResponse.json({ error: `Alasan maksimal ${MAKS_ALASAN} karakter.` }, { status: 400 });
    }

    if (!jenisCutiValid(jenis)) {
      return NextResponse.json({ error: 'Jenis cuti tidak valid.' }, { status: 400 });
    }
    if (file) {
      if (!LAMPIRAN_MIME[file.type]) {
        return NextResponse.json({ error: 'Format lampiran harus PDF, JPG, atau PNG.' }, { status: 400 });
      }
      if (file.size > LAMPIRAN_MAKS_BYTES) {
        return NextResponse.json({ error: 'Ukuran lampiran maksimal 4MB.' }, { status: 400 });
      }
    }

    const tahun = tahunSekarang();
    const tahunMaks = tahun + 1;
    if (tahunDariTanggal(tanggalMulai) < tahun || tahunDariTanggal(tanggalSelesai) > tahunMaks) {
      return NextResponse.json(
        { error: `Pengajuan cuti hanya untuk tahun ${tahun} dan ${tahunMaks}.` },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    const ctx = await ambilKonteksCuti(admin, emp.id);
    if (ctx.error) {
      console.error('Ajukan cuti — konteks error:', ctx.error);
      return NextResponse.json({ error: `Gagal memuat data cuti: ${friendlyError(ctx.error, 'terjadi kesalahan pada server.', { context: 'Muat data cuti' })}` }, { status: 500 });
    }

    // Pecah per tahun; bagian tahun tanpa hari kerja dibuang (tidak ada yang
    // perlu diajukan). Total hari kerja dipakai untuk aturan lampiran.
    const segmen = pecahPerTahun(tanggalMulai, tanggalSelesai)
      .map((s) => ({ ...s, jumlahHari: hitungHariKerja(s.tanggalMulai, s.tanggalSelesai, ctx.hariKerja) }))
      .filter((s) => s.jumlahHari > 0);
    const jumlahHari = segmen.reduce((sum, s) => sum + s.jumlahHari, 0);
    if (jumlahHari === 0) {
      return NextResponse.json(
        { error: 'Rentang tanggal yang dipilih tidak ada hari kerja (semua jatuh di hari libur).' },
        { status: 400 }
      );
    }

    if (!file && lampiranWajib(jenis, jumlahHari)) {
      return NextResponse.json(
        { error: `Pengajuan ${labelJenisCuti(jenis)} ${jumlahHari} hari kerja wajib melampirkan bukti (mis. surat dokter).` },
        { status: 400 }
      );
    }

    const { error: bentrokError, bentrok } = await cariCutiBentrok(admin, {
      employeeId: emp.id,
      tanggalMulai,
      tanggalSelesai,
    });
    if (bentrokError) {
      return NextResponse.json({ error: `Gagal memeriksa pengajuan lain: ${friendlyError(bentrokError, 'terjadi kesalahan pada server.', { context: 'Cek pengajuan cuti bentrok' })}` }, { status: 500 });
    }
    if (bentrok) {
      return NextResponse.json(
        {
          error: `Tanggalnya bentrok dengan pengajuan cuti ${bentrok.status === 'approved' ? 'yang sudah disetujui' : 'yang masih menunggu'} (${formatTanggal(bentrok.tanggal_mulai)} – ${formatTanggal(bentrok.tanggal_selesai)}).`,
        },
        { status: 409 }
      );
    }

    // Kuota hanya bisa dicek kalau akun sudah di-link ke employees_master.
    // Kalau belum, pengajuan tetap diterima (perilaku lama) dan admin
    // mendapat peringatan saat menyetujui. Jenis yang tidak memotong kuota
    // (sakit/izin) tidak dicek.
    if (ctx.master && potongKuota(jenis)) {
      for (const seg of segmen) {
        const { sisa, belumBerhak, berhakMulai } = hitungSisaCuti(ctx.master, seg.tahun, ctx.kebijakan);

        const { data: pendingRows, error: pendingError } = await admin
          .from('leave_requests')
          .select('tanggal_mulai, tanggal_selesai')
          .eq('employee_id', emp.id)
          .eq('status', 'pending')
          .in('jenis', JENIS_POTONG_KUOTA)
          .gte('tanggal_mulai', `${seg.tahun}-01-01`)
          .lte('tanggal_mulai', `${seg.tahun}-12-31`);
        if (pendingError) {
          return NextResponse.json({ error: `Gagal memeriksa kuota: ${friendlyError(pendingError, 'terjadi kesalahan pada server.', { context: 'Cek kuota cuti' })}` }, { status: 500 });
        }

        const hariPending = (pendingRows || []).reduce(
          (sum, r) => sum + hitungHariKerja(r.tanggal_mulai, r.tanggal_selesai, ctx.hariKerja),
          0
        );
        const tersedia = Math.max(0, sisa - hariPending);

        if (seg.jumlahHari > tersedia) {
          if (belumBerhak) {
            return NextResponse.json(
              { error: `Hak cuti tahunan kamu baru terbuka mulai ${formatTanggal(berhakMulai)} (setelah masa kerja minimum terpenuhi).` },
              { status: 400 }
            );
          }
          // Sebut tahunnya kalau pengajuan menyentuh tahun selain tahun berjalan
          // atau terbagi dua, supaya jelas bagian mana yang melebihi kuota.
          const ketTahun = seg.tahun !== tahun || segmen.length > 1 ? ` di tahun ${seg.tahun}` : '';
          const catatan = hariPending > 0 ? ` (${hariPending} hari sudah dipakai pengajuan lain yang menunggu persetujuan)` : '';
          return NextResponse.json(
            { error: `Pengajuan ${seg.jumlahHari} hari kerja${ketTahun} melebihi sisa kuota cuti${ketTahun}: tersedia ${tersedia} hari${catatan}.` },
            { status: 400 }
          );
        }
      }
    }

    // Upload lampiran dilakukan paling akhir, setelah semua validasi lolos,
    // supaya pengajuan yang ditolak validasi tidak meninggalkan file di Drive.
    let lampiran = null;
    if (file) {
      const fileName = `cuti_${jenis}_${tanggalMulai}_${Date.now()}.${LAMPIRAN_MIME[file.type]}`;
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const up = await uploadLeaveAttachmentToDrive(buffer, fileName, file.type, `${emp.nama} (${emp.id.slice(0, 8)})`);
        lampiran = { driveId: up.fileId, nama: fileName };
      } catch (driveError) {
        console.error('Google Drive upload error (lampiran cuti):', driveError);
        return NextResponse.json({ error: 'Gagal mengupload lampiran ke Google Drive. Coba lagi.' }, { status: 500 });
      }
    }

    // Satu perintah insert untuk semua bagian tahun (atomik). Bagian yang
    // lintas tahun memakai lampiran yang sama.
    const { data: inserted, error: insertError } = await admin
      .from('leave_requests')
      .insert(segmen.map((seg) => ({
        employee_id: emp.id,
        tanggal_mulai: seg.tanggalMulai,
        tanggal_selesai: seg.tanggalSelesai,
        alasan,
        jenis,
        lampiran_drive_id: lampiran?.driveId || null,
        lampiran_nama: lampiran?.nama || null,
        status: 'pending',
      })))
      .select();

    if (insertError) {
      if (lampiran) {
        try {
          await deleteEmployeeDocumentFromDrive(lampiran.driveId);
        } catch (cleanupError) {
          console.error('Gagal hapus lampiran yatim:', cleanupError);
        }
      }
      console.error('Ajukan cuti error:', insertError);
      return NextResponse.json({ error: `Gagal mengirim pengajuan cuti: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Kirim pengajuan cuti' })}` }, { status: 500 });
    }

    const data = inserted[0];
    const dataTerakhir = inserted[inserted.length - 1];

    // Notifikasi ke pemegang modul Kelola Cuti Tim (+ superadmin) disusun di
    // server dari data yang baru disimpan (dulu dikirim dari browser dengan
    // teks bebas). Satu notifikasi per pengajuan, walau dipecah per tahun.
    const ketPecah = inserted.length > 1 ? `, dicatat sebagai ${inserted.length} pengajuan per tahun` : '';
    await notifyByModule(admin, {
      moduleKey: 'leave_request_admin',
      tipe: 'cuti_diajukan',
      pesan: `${emp.nama || 'Karyawan'} mengajukan ${potongKuota(data.jenis) ? 'cuti' : labelJenisCuti(data.jenis).toLowerCase()} ${formatTanggal(data.tanggal_mulai)} – ${formatTanggal(dataTerakhir.tanggal_selesai)} (${jumlahHari} hari kerja${ketPecah}).`,
      link: '/employee/leave-request/admin',
    });

    // `request` (baris pertama) dipertahankan demi kompatibilitas klien lama;
    // `requests` berisi semua baris yang dibuat.
    return NextResponse.json({ success: true, request: data, requests: inserted, jumlahHari }, { status: 201 });
  } catch (err) {
    console.error('Ajukan cuti error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
