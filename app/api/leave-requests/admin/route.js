import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { requireModuleAccess } from '@/lib/moduleAccessServer';
import {
  ambilKonteksCuti, ambilKebijakanCuti, cariCutiBentrok, formatTanggal, ubahKuotaTerpakai,
  KOLOM_MASTER_CUTI, FILTER_STATUS_CUTI_VALID, terapkanFilterStatusCuti,
} from '@/lib/leaveServer';
import { parsePageParams, isRangeNotSatisfiable } from '@/lib/pagination';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployee } from '@/lib/notify';
import { tanggalHariIni } from '@/lib/leavePolicy';
import { uploadLeaveAttachmentToDrive, deleteEmployeeDocumentFromDrive } from '@/lib/googleDrive';
import { friendlyError } from '@/lib/errorMessage';
import {
  hitungHariKerja, tahunSekarang, tahunDariTanggal, tanggalValid, geserTanggal,
  JENIS_CUTI_DEFAULT, jenisCutiValid, labelJenisCuti, potongKuota, lampiranWajib,
  LAMPIRAN_MAKS_BYTES, LAMPIRAN_MIME, MAKS_HARI_LAMPAU_INPUT_HR,
  SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN,
} from '@/lib/leave';
import { ambilLibur } from '@/lib/publicHolidays';

// GET /api/leave-requests/admin?status=pending&page=1&pageSize=50
// Data untuk halaman Kelola Pengajuan Cuti: pengajuan (berhalaman) + data
// pendukung untuk baris di halaman itu (karyawan, jadwal kerja, kolom kuota
// employees_master) + kebijakan kuota. status kosong = 'pending'; 'all' = semua;
// 'minta_batal' = cuti disetujui yang diminta batal karyawan dan belum dijawab HR.
//
// Pengajuan dimuat per halaman (range + count), bukan seluruh riwayat, karena
// PostgREST memotong respons di 1.000 baris tanpa error. Urutan: tanggal mulai
// terbaru dulu (sama dengan urutan awal tabel di halaman).
//
// Dulu halaman ini membaca 4 tabel langsung dari browser. RLS employees_master
// dibatasi superadmin (isinya kolom gaji), jadi pemegang modul
// leave_request_admin yang bukan superadmin melihat data kosong. Di sini
// dibaca lewat service role (RLS tidak berlaku), maka hak modul dicek manual
// dan kolom yang dikirim dibatasi — kolom gaji TIDAK ikut.
export async function GET(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['leave_request_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get('status') || 'pending';
    if (statusFilter !== 'all' && !FILTER_STATUS_CUTI_VALID.includes(statusFilter)) {
      return NextResponse.json({ error: 'Filter status tidak valid.' }, { status: 400 });
    }
    const { page, pageSize, from, to } = parsePageParams(searchParams);

    let reqQuery = admin.from('leave_requests').select('*', { count: 'exact' });
    reqQuery = terapkanFilterStatusCuti(reqQuery, statusFilter);
    reqQuery = reqQuery
      .order('tanggal_mulai', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    const [reqRes, policyRes, payrollAccess] = await Promise.all([
      reqQuery,
      ambilKebijakanCuti(admin),
      // Mengubah kebijakan kuota = hak modul Payroll (tempat jatah per karyawan diatur).
      requireModuleAccess(admin, ['payroll']),
    ]);

    // Halaman melewati akhir data (mis. halaman terakhir kosong setelah ada yang
    // diproses): bukan error — klien diminta kembali ke halaman 1.
    if (isRangeNotSatisfiable(reqRes.error)) {
      return NextResponse.json({ outOfRange: true, requests: [], total: 0, page, pageSize });
    }

    const firstError = reqRes.error || policyRes.error;
    if (firstError) {
      console.error('Muat data kelola cuti error:', firstError);
      return NextResponse.json({ error: 'Gagal memuat data pengajuan cuti.' }, { status: 500 });
    }

    const requests = reqRes.data || [];

    // Data pendukung hanya untuk karyawan pada halaman ini (<= pageSize id, jadi
    // `.in(...)` tetap pendek dan tidak menyentuh batas 1.000 baris).
    const empIds = Array.from(new Set(requests.map((r) => r.employee_id).filter(Boolean)));
    let employees = [];
    let schedules = [];
    let master = [];
    let libur = [];
    if (empIds.length > 0) {
      const tahun = tahunSekarang();
      const [empRes, schedRes, masterRes, liburRes] = await Promise.all([
        admin.from('employees').select('id, nama').in('id', empIds).order('nama'),
        // '*' supaya kolom bekerja_di_hari_libur yang baru tidak membuat query
        // gagal sebelum migrasinya dijalankan; yang dikirim ke klien tetap
        // hanya tiga kolom di bawah.
        admin.from('work_schedule').select('*').in('employee_id', empIds),
        admin
          .from('employees_master')
          .select(`${KOLOM_MASTER_CUTI}, linked_employee_id`)
          .in('linked_employee_id', empIds),
        ambilLibur(admin, { dari: `${tahun}-01-01`, sampai: `${tahun + 1}-12-31` }),
      ]);
      const supportError = empRes.error || schedRes.error || masterRes.error || liburRes.error;
      if (supportError) {
        console.error('Muat data pendukung kelola cuti error:', supportError);
        return NextResponse.json({ error: 'Gagal memuat data pengajuan cuti.' }, { status: 500 });
      }
      employees = empRes.data || [];
      schedules = (schedRes.data || []).map((sc) => ({
        employee_id: sc.employee_id,
        hari_kerja: sc.hari_kerja,
        bekerja_di_hari_libur: sc.bekerja_di_hari_libur === true,
      }));
      master = masterRes.data || [];
      // Hari libur nasional/cuti bersama (tahun ini dan depan) untuk menghitung
      // jumlah hari kerja pengajuan yang masih menunggu.
      libur = liburRes.rows.map((l) => ({ tanggal: l.tanggal, nama: l.nama, jenis: l.jenis }));
    }

    return NextResponse.json({
      employees,
      requests,
      schedules,
      libur,
      master,
      total: reqRes.count ?? 0,
      page,
      pageSize,
      kebijakan: policyRes.kebijakan,
      kebijakanVersi: policyRes.versi,
      bisaUbahKebijakan: !payrollAccess.error,
    });
  } catch (err) {
    console.error('Muat data kelola cuti error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}

const MAKS_ALASAN = 500;

// POST /api/leave-requests/admin
// HR mencatat cuti/sakit/izin ATAS NAMA karyawan (mis. sakit mendadak, tidak
// memegang akses, atau lupa mengajukan). Pengajuan langsung berstatus
// 'approved' dan memakai aturan yang sama dengan pengajuan sendiri
// (POST /api/leave-requests) + persetujuan (decision/route.js):
// - hanya pemegang modul leave_request_admin (superadmin lolos otomatis)
// - karyawan target harus aktif; tidak boleh mencatat untuk diri sendiri
//   (SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN di lib/leave.js)
// - rentang HARUS di tahun berjalan (kuota di employees_master hanya melacak
//   satu tahun); tanggal mulai boleh mundur paling banyak
//   MAKS_HARI_LAMPAU_INPUT_HR hari
// - minimal 1 hari kerja menurut jadwal karyawan; tidak bentrok dengan
//   pengajuan pending/approved lain
// - jenis yang memotong kuota (tahunan) dicek dan dipotong lewat
//   compare-and-swap yang sama dengan approve; sakit/izin tidak
// - lampiran: aturan sama dengan pengajuan sendiri (PDF/JPG/PNG maks 4MB,
//   wajib untuk jenis tertentu — lihat JENIS_CUTI di lib/leave.js)
// Body boleh JSON (tanpa lampiran) atau multipart/form-data (field `lampiran`).
// Kolom diinput_oleh = id HR yang mencatat; karyawan diberi notifikasi.
export async function POST(request) {
  try {
    const admin = createAdminClient();
    const access = await requireModuleAccess(admin, ['leave_request_admin']);
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
    const { emp } = access;

    let body = {};
    let file = null;
    if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
      const formData = await request.formData().catch(() => null);
      if (formData) {
        body = {
          employeeId: formData.get('employeeId'),
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

    const employeeId = typeof body?.employeeId === 'string' ? body.employeeId.trim() : '';
    const tanggalMulai = body?.tanggalMulai;
    const tanggalSelesai = body?.tanggalSelesai;
    const alasan = typeof body?.alasan === 'string' ? body.alasan.trim() : '';
    const jenis = body?.jenis ? String(body.jenis) : JENIS_CUTI_DEFAULT;

    if (!employeeId) {
      return NextResponse.json({ error: 'Pilih karyawan terlebih dahulu.' }, { status: 400 });
    }
    if (employeeId === emp.id && !(SELF_APPROVAL_ALLOWED_FOR_SUPERADMIN && emp.is_superadmin)) {
      return NextResponse.json({ error: 'Tidak boleh mencatat cuti untuk diri sendiri. Ajukan lewat halaman Pengajuan Cuti.' }, { status: 403 });
    }
    if (!tanggalValid(tanggalMulai) || !tanggalValid(tanggalSelesai)) {
      return NextResponse.json({ error: 'Tanggal mulai dan tanggal selesai wajib diisi dengan benar.' }, { status: 400 });
    }
    if (tanggalSelesai < tanggalMulai) {
      return NextResponse.json({ error: 'Tanggal selesai tidak boleh sebelum tanggal mulai.' }, { status: 400 });
    }
    if (!alasan) {
      return NextResponse.json({ error: 'Alasan wajib diisi.' }, { status: 400 });
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
    if (tahunDariTanggal(tanggalMulai) !== tahun || tahunDariTanggal(tanggalSelesai) !== tahun) {
      return NextResponse.json(
        { error: `Pencatatan oleh HR hanya untuk tanggal di tahun ${tahun} (kuota cuti hanya dilacak per tahun berjalan). Untuk rentang lintas tahun, catat per tahun atau minta karyawan mengajukan sendiri.` },
        { status: 400 }
      );
    }
    const batasMundur = geserTanggal(tanggalHariIni(), -MAKS_HARI_LAMPAU_INPUT_HR);
    if (tanggalMulai < batasMundur) {
      return NextResponse.json(
        { error: `Tanggal mulai tidak boleh lebih dari ${MAKS_HARI_LAMPAU_INPUT_HR} hari ke belakang (paling awal ${formatTanggal(batasMundur)}).` },
        { status: 400 }
      );
    }

    const { data: target, error: targetError } = await admin
      .from('employees')
      .select('id, nama, status')
      .eq('id', employeeId)
      .maybeSingle();
    if (targetError) {
      return NextResponse.json({ error: `Gagal memuat data karyawan: ${friendlyError(targetError, 'terjadi kesalahan pada server.', { context: 'Muat karyawan' })}` }, { status: 500 });
    }
    if (!target) {
      return NextResponse.json({ error: 'Karyawan tidak ditemukan.' }, { status: 404 });
    }
    if (target.status !== 'Aktif') {
      return NextResponse.json({ error: 'Karyawan ini tidak aktif, pengajuan tidak bisa dicatat.' }, { status: 400 });
    }

    const ctx = await ambilKonteksCuti(admin, target.id);
    if (ctx.error) {
      console.error('Input cuti HR — konteks error:', ctx.error);
      return NextResponse.json({ error: `Gagal memuat data cuti: ${friendlyError(ctx.error, 'terjadi kesalahan pada server.', { context: 'Muat data cuti' })}` }, { status: 500 });
    }

    const jumlahHari = hitungHariKerja(tanggalMulai, tanggalSelesai, ctx.hariKerja, ctx.libur);
    if (jumlahHari === 0) {
      return NextResponse.json(
        { error: 'Rentang tanggal yang dipilih tidak ada hari kerja menurut jadwal karyawan (semua jatuh di hari libur).' },
        { status: 400 }
      );
    }

    if (!file && lampiranWajib(jenis, jumlahHari)) {
      return NextResponse.json(
        { error: `${labelJenisCuti(jenis)} ${jumlahHari} hari kerja wajib melampirkan bukti (mis. surat dokter).` },
        { status: 400 }
      );
    }

    const { error: bentrokError, bentrok } = await cariCutiBentrok(admin, {
      employeeId: target.id,
      tanggalMulai,
      tanggalSelesai,
    });
    if (bentrokError) {
      return NextResponse.json({ error: `Gagal memeriksa pengajuan lain: ${friendlyError(bentrokError, 'terjadi kesalahan pada server.', { context: 'Cek pengajuan cuti bentrok' })}` }, { status: 500 });
    }
    if (bentrok) {
      return NextResponse.json(
        {
          error: `Tanggalnya bentrok dengan pengajuan cuti ${bentrok.status === 'approved' ? 'yang sudah disetujui' : 'yang masih menunggu'} milik ${target.nama || 'karyawan'} (${formatTanggal(bentrok.tanggal_mulai)} – ${formatTanggal(bentrok.tanggal_selesai)}). Proses atau batalkan pengajuan itu dulu.`,
        },
        { status: 409 }
      );
    }

    // Potong kuota lebih dulu (compare-and-swap, sama seperti approve); semua
    // langkah setelahnya mengembalikan potongan ini bila gagal.
    const potong = potongKuota(jenis);
    let kuota = null;
    let warning = null;
    if (potong) {
      if (ctx.master) {
        const q = await ubahKuotaTerpakai(admin, ctx.master.id, tahun, jumlahHari, { batasiJatah: true, kebijakan: ctx.kebijakan });
        if (!q.ok) {
          if (q.reason === 'kuota') {
            const pesanKuota = q.belumBerhak
              ? `Karyawan ini belum berhak cuti tahunan (hak cuti terbuka mulai ${formatTanggal(q.berhakMulai)} sesuai kebijakan masa kerja).`
              : `Sisa kuota tidak cukup: butuh ${jumlahHari} hari, sisa ${q.sisa} dari ${q.jatah} hari. Naikkan jatah di Payroll Manager atau pilih jenis lain.`;
            return NextResponse.json({ error: pesanKuota }, { status: 409 });
          }
          if (q.reason === 'konflik') {
            return NextResponse.json({ error: 'Kuota sedang diubah proses lain. Coba lagi.' }, { status: 409 });
          }
          return NextResponse.json({ error: `Gagal memperbarui kuota: ${friendlyError(q.error ?? q.message, 'terjadi kesalahan pada server.', { context: 'Ubah kuota cuti' })}` }, { status: 500 });
        }
        kuota = { master_id: ctx.master.id, cuti_terpakai: q.terpakai, cuti_terpakai_tahun: q.tahun, ...q.carry };
      } else {
        warning = 'Cuti dicatat. Karyawan ini belum terhubung ke data master (Payroll), sisa kuota tidak diperbarui.';
      }
    }
    const kembalikanKuota = () =>
      kuota ? ubahKuotaTerpakai(admin, ctx.master.id, tahun, -jumlahHari, { kebijakan: ctx.kebijakan }) : Promise.resolve(null);

    // Upload lampiran paling akhir sebelum insert, setelah semua validasi lolos.
    let lampiran = null;
    if (file) {
      const fileName = `cuti_${jenis}_${tanggalMulai}_${Date.now()}.${LAMPIRAN_MIME[file.type]}`;
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        const up = await uploadLeaveAttachmentToDrive(buffer, fileName, file.type, `${target.nama} (${target.id.slice(0, 8)})`);
        lampiran = { driveId: up.fileId, nama: fileName };
      } catch (driveError) {
        console.error('Google Drive upload error (lampiran cuti HR):', driveError);
        await kembalikanKuota();
        return NextResponse.json({ error: 'Gagal mengupload lampiran ke Google Drive. Coba lagi.' }, { status: 500 });
      }
    }

    const { data: inserted, error: insertError } = await admin
      .from('leave_requests')
      .insert({
        employee_id: target.id,
        tanggal_mulai: tanggalMulai,
        tanggal_selesai: tanggalSelesai,
        alasan,
        jenis,
        lampiran_drive_id: lampiran?.driveId || null,
        lampiran_nama: lampiran?.nama || null,
        status: 'approved',
        approved_by: emp.id,
        diinput_oleh: emp.id,
        jumlah_hari: jumlahHari,
      })
      .select()
      .maybeSingle();

    if (insertError || !inserted) {
      await kembalikanKuota();
      if (lampiran) {
        try {
          await deleteEmployeeDocumentFromDrive(lampiran.driveId);
        } catch (cleanupError) {
          console.error('Gagal hapus lampiran yatim:', cleanupError);
        }
      }
      console.error('Input cuti HR error:', insertError);
      return NextResponse.json({ error: `Gagal menyimpan pengajuan cuti: ${friendlyError(insertError, 'terjadi kesalahan pada server.', { context: 'Simpan cuti oleh HR' })}` }, { status: 500 });
    }

    await logActivity(admin, {
      userId: emp.id,
      aksi: 'input_cuti_hr',
      targetTable: 'leave_requests',
      targetId: inserted.id,
      detail: {
        employee_id: target.id,
        tanggal_mulai: tanggalMulai,
        tanggal_selesai: tanggalSelesai,
        jenis,
        jumlah_hari_kerja: jumlahHari,
        kuota_terpakai_setelah: kuota ? kuota.cuti_terpakai : null,
        dengan_lampiran: !!lampiran,
      },
    });

    // Tipe 'cuti_approved' dipakai ulang (ikon hijau + email kategori
    // keputusan) karena hasilnya sama dengan pengajuan yang disetujui.
    await notifyEmployee(admin, {
      userId: target.id,
      tipe: 'cuti_approved',
      pesan: `HR mencatat ${potong ? 'cuti' : labelJenisCuti(jenis).toLowerCase()} untukmu (${formatTanggal(tanggalMulai)} – ${formatTanggal(tanggalSelesai)}, ${jumlahHari} hari kerja). Status: disetujui.`,
      link: '/employee/leave-request',
    });

    return NextResponse.json({ success: true, request: inserted, kuota, warning, jumlahHari }, { status: 201 });
  } catch (err) {
    console.error('Input cuti HR error:', err);
    return NextResponse.json({ error: 'Terjadi kesalahan server.' }, { status: 500 });
  }
}
