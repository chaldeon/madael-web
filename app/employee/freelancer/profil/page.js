'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { callJsonApi } from '@/lib/apiClient';
import EmployeeHeader from '@/components/EmployeeHeader';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import Toast from '@/components/employee-list/Toast';
import PaymentForm from '@/components/freelancer/PaymentForm';
import AgreementCard from '@/components/freelancer/AgreementCard';
import { freelancerStatusLabel } from '@/lib/freelancerModules';
import { AGREEMENT_STATUS, AGREEMENT_STATUS_LABEL } from '@/lib/freelancerAgreementConfig';
import { PROFILE_PAYMENT_LABEL } from '@/lib/freelancerProfile';

// Nilai tetap untuk akun Freelancer (FRE-Q-25: nilai pilihan belum diputuskan;
// ubah di sini bila diputuskan lain). Hanya tampil di halaman milik Freelancer
// sendiri; tampilan untuk Tim/superadmin belum termasuk lingkup halaman ini.
const HUBUNGAN_KERJA = 'Freelance';
const PERAN = 'Rekruter';

const cardClass = 'bg-white border border-[#E0E0E0] p-6 mt-6';

function formatTanggal(value) {
  if (!value) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function Baris({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-medium text-[#6B6B6B] mb-1">{label}</dt>
      <dd className="text-sm text-black break-words">{value || '-'}</dd>
    </div>
  );
}

// Banner syarat akses. Hanya dirender bila profil DAN Agreement sama-sama berhasil
// dimuat, supaya tidak pernah menyatakan syarat belum/sudah terpenuhi dari data
// yang tidak lengkap.
function BannerSyaratAkses({ profile, agreement }) {
  const profilLengkap = profile.profile_complete;
  const agreementOk = agreement.status === AGREEMENT_STATUS.TERVERIFIKASI;

  if (profilLengkap && agreementOk) {
    return (
      <div className="flex items-start gap-3 border-l-4 border-[#166534] bg-white p-4">
        <CheckCircle2 size={18} className="text-[#166534] shrink-0 mt-0.5" />
        <p className="text-sm text-black">
          Syarat akses Job Ad sudah terpenuhi: profil lengkap dan Agreement terverifikasi.
        </p>
      </div>
    );
  }

  const kosong = (profile.missing_fields || []).map((key) => PROFILE_PAYMENT_LABEL[key] || key);

  return (
    <div className="border-l-4 border-amber-500 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle size={18} className="text-amber-700 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-black">Job Ad belum terbuka untuk kamu.</p>
          <p className="text-sm text-black mt-1">
            Job Ad baru terbuka setelah profil kamu lengkap dan Agreement terverifikasi oleh Tim Internal.
          </p>
          <ul className="text-sm text-black mt-3 space-y-1.5">
            <li>
              <span className="font-medium">Profil:</span>{' '}
              {profilLengkap ? 'sudah lengkap' : `belum lengkap (belum diisi: ${kosong.join(', ')})`}
            </li>
            <li>
              <span className="font-medium">Agreement:</span>{' '}
              {(AGREEMENT_STATUS_LABEL[agreement.status] || agreement.status).toLowerCase()}
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

// Halaman Profil Saya untuk akun Freelancer (FRE-TOOL-06): data akun (read-only),
// hubungan kerja/peran, data pembayaran, Agreement, dan banner syarat akses.
//
// Semua data lewat API milik sendiri (id Freelancer dari sesi di server):
//   GET/PATCH /api/freelancer/me/profile      (FRE-TOOL-05)
//   GET/POST  /api/freelancer/me/agreement    (FRE-TOOL-04)
// Halaman ini tidak membaca tabel langsung dari browser, karena kolom pembayaran
// memang tidak punya izin SELECT untuk role authenticated. Profil Saya tidak
// gated, jadi tetap terbuka walaupun syarat akses belum terpenuhi.
export default function FreelancerProfilPage() {
  const router = useRouter();

  const [reloadTick, setReloadTick] = useState(0);
  // Loading diturunkan dari key (bukan setState sinkron di effect), pola yang sama
  // dengan halaman detail Freelancer di sisi Tim.
  const [loaded, setLoaded] = useState({
    key: null,
    profile: null,
    profileError: null,
    profileStatus: null,
    agreement: null,
    agreementError: null,
  });
  // Naik setiap simpan berhasil supaya form dipasang ulang dengan nilai yang sudah
  // dinormalisasi server (rekening/NPWP-NIK menjadi angka saja).
  const [formVersion, setFormVersion] = useState(0);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [p, a] = await Promise.all([
        callJsonApi('/api/freelancer/me/profile', 'GET'),
        callJsonApi('/api/freelancer/me/agreement', 'GET'),
      ]);
      if (cancelled) return;
      // Sesi habis: layar loading tetap tampil selama pindah ke login.
      if (p.status === 401 || a.status === 401) {
        router.replace('/employee/login');
        return;
      }
      setLoaded({
        key: reloadTick,
        profile: p.ok ? p.data.profile : null,
        profileError: p.ok ? null : p.error,
        profileStatus: p.ok ? null : p.status ?? null,
        agreement: a.ok ? a.data.agreement : null,
        agreementError: a.ok ? null : a.error,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadTick, router]);

  const loading = loaded.key !== reloadTick;
  const { profile, profileError, profileStatus, agreement, agreementError } = loaded;
  const retry = () => setReloadTick((t) => t + 1);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/employee/login');
    router.refresh();
  };

  // Muat ulang Agreement diam-diam (tanpa layar loading), dipakai setelah unggah
  // gagal karena status baru saja berubah (409) supaya tampilan sesuai keadaan terbaru.
  const segarkanAgreement = async () => {
    const res = await callJsonApi('/api/freelancer/me/agreement', 'GET');
    if (res.ok) setLoaded((prev) => ({ ...prev, agreement: res.data.agreement, agreementError: null }));
  };

  const handleProfileSaved = (nextProfile, tidakBerubah) => {
    setLoaded((prev) => ({ ...prev, profile: nextProfile, profileError: null }));
    setFormVersion((v) => v + 1);
    setToast({ type: 'success', message: tidakBerubah ? 'Tidak ada perubahan data pembayaran.' : 'Data pembayaran tersimpan.' });
  };

  const account = profile?.account;
  // 403 = bukan akun Freelancer atau akun tidak aktif: satu pesan untuk seluruh
  // halaman, bukan pesan yang sama di setiap bagian.
  const diblokir = !loading && profileStatus === 403;

  return (
    <section className="min-h-screen bg-[#F4F4F4]">
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <EmployeeHeader
        onLogout={handleLogout}
        left={
          account ? (
            <div>
              <p className="text-sm font-semibold text-black">{account.nama_lengkap}</p>
              <p className="text-xs text-[#6B6B6B]">Freelancer · {account.freelancer_code}</p>
            </div>
          ) : (
            <p className="text-sm font-semibold text-black">Freelancer</p>
          )
        }
        subnav={
          <Link href="/employee/freelancer" className="text-sm text-[#6B6B6B] hover:text-black">
            ← Dashboard Freelancer
          </Link>
        }
      />

      <div className="max-w-[820px] mx-auto px-6 py-10">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-1">Profil Saya</h1>
        <p className="text-sm text-[#6B6B6B] mb-6">
          Lengkapi data pembayaran dan Agreement kamu, lalu pantau statusnya di sini.
        </p>

        {loading ? (
          <LoadingState label="Memuat Profil Saya..." />
        ) : diblokir ? (
          <ErrorState message={profileError} />
        ) : (
          <>
            {profile && agreement && <BannerSyaratAkses profile={profile} agreement={agreement} />}

            {profile ? (
              <>
                <div className={cardClass}>
                  <h2 className="text-sm font-medium text-black mb-3">Data Akun</h2>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                    <Baris label="Freelancer ID" value={account.freelancer_code} />
                    <Baris label="Nama lengkap" value={account.nama_lengkap} />
                    <Baris label="Email" value={account.email} />
                    <Baris label="Nomor WhatsApp" value={account.no_whatsapp} />
                    <Baris label="Alamat" value={account.alamat} />
                    <Baris label="Tanggal bergabung" value={formatTanggal(account.tanggal_bergabung)} />
                    <Baris label="Status akun" value={freelancerStatusLabel(account.status)} />
                    <Baris label="Jenis hubungan kerja" value={HUBUNGAN_KERJA} />
                    <Baris label="Peran" value={PERAN} />
                  </dl>
                  <p className="text-xs text-[#9A9A9A] mt-4">
                    Data akun tidak dapat diubah dari sini. Hubungi Tim Internal Madael bila ada yang perlu diperbarui.
                  </p>
                </div>

                <div className={cardClass}>
                  <h2 className="text-sm font-medium text-black mb-3">Data Pembayaran</h2>
                  <PaymentForm key={formVersion} payment={profile.payment} onSaved={handleProfileSaved} />
                </div>
              </>
            ) : (
              <div className={cardClass}>
                <h2 className="text-sm font-medium text-black mb-3">Data Akun dan Pembayaran</h2>
                <ErrorState message={profileError} onRetry={retry} />
              </div>
            )}

            <div className={cardClass}>
              <h2 className="text-sm font-medium text-black mb-3">Agreement</h2>
              {agreement ? (
                <AgreementCard
                  agreement={agreement}
                  onChange={(next) => setLoaded((prev) => ({ ...prev, agreement: next, agreementError: null }))}
                  onRefresh={segarkanAgreement}
                  onToast={setToast}
                />
              ) : (
                <ErrorState message={agreementError} onRetry={retry} />
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
