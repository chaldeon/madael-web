import { NextResponse, after } from 'next/server';
import { supabase } from '@/lib/supabase';
import { uploadCVToDrive } from '@/lib/googleDrive';
import { createAdminClient } from '@/lib/supabase-admin';
import { notifyByModule, notifyEmployees } from '@/lib/notify';
import { isJobOpen } from '@/lib/jobStatus';
import { EMAIL_RE, isMailConfigured, sendApplicationReceivedEmail } from '@/lib/applicationEmail';
import { APPLY_RATE_LIMIT, HONEYPOT_FIELD, getClientIp, rateLimit } from '@/lib/antiSpam';

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const GENERAL_FOLDER_NAME = 'Umum';

// Maksimal satu email konfirmasi per alamat email dalam jendela ini, supaya
// endpoint publik tidak bisa dipakai membanjiri kotak masuk orang lain.
const CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;

// Batas lamaran per IP per jam bisa diubah lewat env APPLY_RATE_LIMIT_PER_HOUR
// (0 = matikan rate limit). Berguna kalau hosting tidak meneruskan IP asli
// pengunjung sehingga semua pelamar terlihat berasal dari satu IP.
const envLimit = Number.parseInt(process.env.APPLY_RATE_LIMIT_PER_HOUR ?? '', 10);
const rateConfig = {
  ...APPLY_RATE_LIMIT,
  limit: Number.isNaN(envLimit) || envLimit < 0 ? APPLY_RATE_LIMIT.limit : envLimit,
};

export async function POST(request) {
  try {
    // Rate limit per IP — dicek paling awal, sebelum membaca file CV dan
    // sebelum upload ke Drive. Hanya aktif di production (saat dev lokal semua
    // request berasal dari satu IP) dan dilewati kalau IP tidak terdeteksi.
    const clientIp = getClientIp(request);
    if (clientIp && rateConfig.limit > 0 && process.env.NODE_ENV === 'production') {
      const limited = rateLimit(`apply:${clientIp}`, rateConfig);
      if (!limited.ok) {
        return NextResponse.json(
          { error: 'Terlalu banyak percobaan mengirim lamaran. Silakan coba lagi nanti.' },
          { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } }
        );
      }
    }

    const formData = await request.formData();

    // Honeypot: field tersembunyi yang tidak pernah diisi manusia. Kalau terisi,
    // anggap bot — balas sukses palsu supaya bot tidak tahu ia terdeteksi, tanpa
    // upload ke Drive, tanpa menyimpan, tanpa notifikasi.
    if ((formData.get(HONEYPOT_FIELD) || '').toString().trim() !== '') {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const nama = (formData.get('nama') || '').toString().trim();
    const email = (formData.get('email') || '').toString().trim();
    const telepon = (formData.get('telepon') || '').toString().trim();
    const jobId = (formData.get('job_id') || '').toString().trim();
    const positionName = (formData.get('posisi') || '').toString().trim();
    // Diisi hanya untuk lamaran umum (bukan apply ke lowongan spesifik):
    // teks bebas posisi yang diminati kandidat, disimpan di kolom `catatan`.
    const posisiMinat = (formData.get('posisi_minat') || '').toString().trim();
    const answersRaw = (formData.get('answers') || '').toString().trim();
    const file = formData.get('cv');

    // Lamaran umum = tidak ada job_id (form "Tidak menemukan posisi yang sesuai?")
    const isGeneral = !jobId;

    // Jawaban pertanyaan custom per posisi (opsional) — dikirim sebagai JSON string.
    let answers = null;
    if (!isGeneral && answersRaw) {
      try {
        const parsed = JSON.parse(answersRaw);
        if (Array.isArray(parsed)) answers = parsed;
      } catch {
        answers = null;
      }
    }

    // Validasi dasar
    if (!nama || !email || !file) {
      return NextResponse.json(
        { error: 'Nama, email, dan file CV wajib diisi.' },
        { status: 400 }
      );
    }

    if (!isGeneral && !positionName) {
      return NextResponse.json({ error: 'Posisi wajib diisi.' }, { status: 400 });
    }

    if (isGeneral && !posisiMinat) {
      return NextResponse.json(
        { error: 'Posisi yang diminati wajib diisi.' },
        { status: 400 }
      );
    }

    if (typeof file === 'string') {
      return NextResponse.json({ error: 'File CV tidak valid.' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'File CV harus berformat PDF.' }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Ukuran file CV maksimal 5MB.' }, { status: 400 });
    }

    // Tolak lamaran ke lowongan yang sudah nonaktif atau lewat deadline.
    // Dicek di server (bukan hanya disembunyikan di halaman publik) supaya link
    // lama / request langsung tidak bisa menembus lowongan yang sudah tutup.
    // Dilakukan SEBELUM upload ke Drive agar tidak menyisakan CV yatim.
    // Judul lowongan dari database dipakai juga untuk email konfirmasi
    // (bukan `posisi` dari form, yang bisa diisi sembarang oleh pengunjung).
    let jobTitle = null;
    if (!isGeneral) {
      const { data: job, error: jobError } = await createAdminClient()
        .from('job_listings')
        .select('id, title, is_active, closes_at')
        .eq('id', jobId)
        .maybeSingle();

      if (jobError) {
        console.error('Supabase job lookup error:', jobError);
        return NextResponse.json(
          { error: 'Terjadi kesalahan pada server. Silakan coba lagi.' },
          { status: 500 }
        );
      }

      if (!job) {
        return NextResponse.json({ error: 'Lowongan tidak ditemukan.' }, { status: 404 });
      }

      if (!isJobOpen(job)) {
        return NextResponse.json(
          { error: 'Lowongan ini sudah ditutup dan tidak lagi menerima lamaran.' },
          { status: 410 }
        );
      }

      jobTitle = job.title;
    }

    // Siapkan file untuk diupload
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const safeNama = nama.replace(/[^a-zA-Z0-9]+/g, '_');
    const fileName = `${safeNama}_${Date.now()}.pdf`;

    // Upload ke Google Drive — folder per posisi untuk apply spesifik,
    // atau folder tetap "Umum" untuk lamaran umum.
    const driveFolderName = isGeneral ? GENERAL_FOLDER_NAME : positionName || 'Lainnya';

    let cvDriveId;
    try {
      cvDriveId = await uploadCVToDrive(fileBuffer, fileName, driveFolderName);
    } catch (driveError) {
      console.error('Google Drive upload error:', driveError);
      return NextResponse.json(
        { error: 'Gagal mengupload CV ke Google Drive. Silakan coba lagi.' },
        { status: 500 }
      );
    }

    // Simpan record pelamar ke Supabase
    // Catatan: tidak pakai .select() di sini karena role "anon" (dipakai lewat
    // anon key yang publik) sengaja tidak diberi izin RLS untuk SELECT pada
    // tabel applications -- data pelamar (nama/email/telepon) tidak seharusnya
    // bisa dibaca langsung dari client manapun.
    const { error } = await supabase.from('applications').insert([
      {
        job_id: isGeneral ? null : jobId,
        nama,
        email,
        telepon: telepon || null,
        cv_drive_id: cvDriveId,
        cv_filename: fileName,
        status: 'Baru',
        catatan: isGeneral ? posisiMinat : null,
        answers,
      },
    ]);

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json(
        { error: 'CV berhasil diupload, tetapi gagal menyimpan data pelamar. Hubungi admin.' },
        { status: 500 }
      );
    }

    // Notifikasi in-app ke tim rekrutmen (pemegang akses modul job_portal +
    // superadmin). Pakai admin client karena endpoint ini publik/anon —
    // tidak ada sesi login yang bisa dipakai untuk query employees/employee_modules.
    // Fire-and-forget: gagal kirim notifikasi tidak boleh menggagalkan submit
    // lamaran yang sudah berhasil tersimpan.
    try {
      const admin = createAdminClient();
      await notifyByModule(admin, {
        moduleKey: 'job_portal',
        tipe: 'pelamar_baru',
        pesan: `Lamaran baru dari ${nama} untuk posisi ${isGeneral ? (posisiMinat || 'Umum') : positionName}.`,
        link: '/employee/job-portal/pelamar',
      });

      // Reviewer terbatas (job_portal_assigned) tidak ikut tercakup notifyByModule
      // di atas — kabari hanya yang di-assign ke lowongan ini.
      if (!isGeneral) {
        const { data: reviewers } = await admin
          .from('job_listing_reviewers')
          .select('employee_id')
          .eq('job_id', jobId);
        await notifyEmployees(admin, {
          userIds: (reviewers || []).map((r) => r.employee_id),
          tipe: 'pelamar_baru',
          pesan: `Lamaran baru dari ${nama} untuk posisi ${positionName}.`,
          link: '/employee/job-portal/pelamar',
        });
      }
    } catch (notifyErr) {
      console.error('Gagal mengirim notifikasi pelamar baru:', notifyErr);
    }

    // Email konfirmasi ke pelamar. Dijalankan lewat after() supaya tidak
    // memperlambat respons, dan seluruh kegagalannya (SMTP, query) hanya
    // dicatat di log — lamaran sudah tersimpan dan respons sukses tidak berubah.
    // Dilewati tanpa error bila SMTP belum dikonfigurasi atau email tidak valid.
    if (isMailConfigured() && EMAIL_RE.test(email)) {
      const posisiEmail = isGeneral ? posisiMinat : jobTitle;
      after(async () => {
        try {
          // Batasi 1 konfirmasi per alamat per 24 jam. Baris yang baru saja
          // disisipkan ikut terhitung, jadi lebih dari 1 berarti sudah pernah
          // ada lamaran dari alamat ini. Dicocokkan tanpa membedakan huruf besar/
          // kecil agar variasi kapitalisasi tidak melewati batas; karakter
          // wildcard LIKE (% _ \) di-escape supaya dicocokkan apa adanya.
          const since = new Date(Date.now() - CONFIRMATION_WINDOW_MS).toISOString();
          const { count, error: countError } = await createAdminClient()
            .from('applications')
            .select('id', { count: 'exact', head: true })
            .ilike('email', email.replace(/[\\%_]/g, '\\$&'))
            .gte('created_at', since);

          // Gagal menghitung → jangan kirim (lebih aman daripada membuka celah spam).
          if (countError) {
            console.error('Gagal memeriksa batas email konfirmasi lamaran:', countError);
            return;
          }
          if ((count ?? 0) > 1) return;

          await sendApplicationReceivedEmail({ to: email, nama, posisi: posisiEmail });
        } catch (mailErr) {
          console.error('Gagal mengirim email konfirmasi lamaran:', mailErr);
        }
      });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('Apply API unexpected error:', err);
    return NextResponse.json(
      { error: 'Terjadi kesalahan pada server. Silakan coba lagi.' },
      { status: 500 }
    );
  }
}