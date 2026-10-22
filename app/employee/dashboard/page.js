'use client';

import GlobalSearchBar from '@/components/GlobalSearchBar';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronDown, Lock, Megaphone, Pin, X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { MODULE_REGISTRY, EXPLICIT_ONLY_MODULES, PENDING_QUEUE_MODULES, isModuleGranted } from '@/lib/employeeModules';
import KontrakBerakhirWidget from '@/components/KontrakBerakhirWidget';
import EmployeeHeader from '@/components/EmployeeHeader';
import QuickClockInCard from '@/components/QuickClockInCard';
import { missingFieldsForEmployee, EMPLOYEE_COMPLETENESS_COLUMNS } from '@/lib/dataCompleteness';

// Pengumuman aktif = belum ada expired_at, atau expired_at masih di masa
// depan. Dicek ulang di RLS/insert admin, ini cuma filter tampilan.
function isActive(row) {
  return !row.expired_at || new Date(row.expired_at) > new Date();
}

// Pengumuman tanpa target (target_company_id kosong) untuk semua karyawan;
// yang bertarget hanya untuk karyawan di perusahaan itu. RLS sudah membatasi
// untuk karyawan biasa, tapi pengelola/superadmin bisa membaca semuanya, jadi
// banner tetap menyaring berdasarkan perusahaan karyawan yang sedang login.
function isForCompany(row, clientId) {
  if (row.target_company_id === null || row.target_company_id === undefined) return true;
  return clientId !== null && clientId !== undefined && String(row.target_company_id) === String(clientId);
}

// Widget banner pengumuman, tampil di atas grid modul. Menampilkan pengumuman
// yang belum ditandai "sudah dibaca" oleh employee yang sedang login, plus
// pengumuman yang di-pin admin (tetap tampil di atas walau sudah dibaca).
function AnnouncementBanner({ supabase, employeeId, clientId }) {
  const [announcements, setAnnouncements] = useState([]);
  const [readIds, setReadIds] = useState([]);
  const [dismissing, setDismissing] = useState(null);

  const loadData = useCallback(async () => {
    if (!employeeId) return;

    // Kedaluwarsa disaring di query (bukan cuma di client) dan jumlahnya dibatasi,
    // supaya riwayat pengumuman lama tidak ikut terunduh tiap buka dashboard.
    const nowIso = new Date().toISOString();
    const targetFilter = clientId
      ? `target_company_id.is.null,target_company_id.eq.${clientId}`
      : 'target_company_id.is.null';
    const [annRes, readRes] = await Promise.all([
      supabase
        .from('announcements')
        .select('id, judul, isi, expired_at, pinned, target_company_id')
        .or(`expired_at.is.null,expired_at.gt.${nowIso}`)
        .or(targetFilter)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('announcement_reads').select('announcement_id').eq('employee_id', employeeId),
    ]);

    setAnnouncements((annRes.data || []).filter((a) => isActive(a) && isForCompany(a, clientId)));
    setReadIds((readRes.data || []).map((r) => r.announcement_id));
  }, [supabase, employeeId, clientId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDismiss = async (announcementId) => {
    setDismissing(announcementId);
    // Optimistic — langsung hilang dari daftar, insert dikirim di belakang.
    setReadIds((prev) => [...prev, announcementId]);
    const { error } = await supabase
      .from('announcement_reads')
      .insert([{ announcement_id: announcementId, employee_id: employeeId }]);
    setDismissing(null);
    if (error) {
      // Kegagalan insert bukan hal fatal — pengumuman cuma akan muncul lagi
      // di reload berikutnya, employee tetap bisa lanjut kerja.
      console.error('Gagal menandai pengumuman sebagai dibaca:', error.message);
    }
  };

  // Daftar sudah terurut (pin dulu, lalu terbaru). Yang sudah dibaca hanya
  // tampil kalau di-pin.
  const visible = announcements.filter((a) => a.pinned || !readIds.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <div className="mb-8 space-y-3">
      {visible.map((a) => {
        const isRead = readIds.includes(a.id);
        const Icon = a.pinned ? Pin : Megaphone;
        return (
          <div
            key={a.id}
            className={`border-l-4 bg-white p-4 flex items-start gap-3 ${isRead ? 'border-[#C9C9C9]' : 'border-madael-red'}`}
          >
            <Icon size={18} className={`shrink-0 mt-0.5 ${isRead ? 'text-[#9A9A9A]' : 'text-madael-red'}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-black">{a.judul}</p>
              <p className="text-xs text-[#6B6B6B] mt-1 whitespace-pre-wrap">{a.isi}</p>
              {isRead && <p className="text-[11px] text-[#9A9A9A] mt-2">Sudah dibaca · disematkan admin</p>}
            </div>
            {!isRead && (
              <button
                onClick={() => handleDismiss(a.id)}
                disabled={dismissing === a.id}
                className="text-[#9A9A9A] hover:text-black shrink-0 disabled:opacity-50"
                title="Tandai sudah dibaca"
              >
                <X size={16} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function EmployeeDashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [employee, setEmployee] = useState(null);
  const [moduleKeys, setModuleKeys] = useState([]);
  const [profileIncomplete, setProfileIncomplete] = useState(false);
  const [pendingCounts, setPendingCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/employee/login');
      return;
    }

    const { data: emp, error: empError } = await supabase
      .from('employees')
      .select('id, nama, email, status, is_superadmin, client_id')
      .eq('email', user.email)
      .maybeSingle();

    if (empError || !emp) {
      setError('Akun ini belum terdaftar sebagai employee. Hubungi superadmin.');
      setLoading(false);
      return;
    }

    if (emp.status !== 'Aktif') {
      setError('Akun employee kamu sedang tidak aktif. Hubungi superadmin.');
      setLoading(false);
      return;
    }

    // Nama perusahaan cuma buat ditampilkan di header — diambil terpisah dan
    // best-effort, supaya kalau relasi companies belum siap/gagal, itu TIDAK
    // sampai memblokir login (beda dari cek di atas yang memang wajib). Hanya
    // `data`-nya yang dipakai, error companies diabaikan. Dijalankan paralel
    // dengan query employee_modules karena keduanya sama-sama hanya butuh emp.
    const companyQuery = emp.client_id
      ? supabase
          .from('companies')
          .select('nama_perusahaan')
          .eq('id', emp.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null });

    // Superadmin bypass semua modul kecuali EXPLICIT_ONLY_MODULES, jadi untuk
    // mereka cukup ambil baris explicit-only saja.
    let modsQuery = supabase
      .from('employee_modules')
      .select('module_name')
      .eq('employee_id', emp.id);
    if (emp.is_superadmin) modsQuery = modsQuery.in('module_name', EXPLICIT_ONLY_MODULES);

    // Data master untuk titik pengingat di kartu Profil Saya — juga best-effort
    // dan paralel: kalau gagal atau akun belum terhubung ke master, titiknya
    // sekadar tidak muncul (halaman Profil Saya yang menjelaskan kasus itu).
    const masterQuery = supabase
      .from('employees_master')
      .select(EMPLOYEE_COMPLETENESS_COLUMNS)
      .eq('linked_employee_id', emp.id)
      .maybeSingle();

    const [{ data: company }, { data: mods }, { data: master }] = await Promise.all([companyQuery, modsQuery, masterQuery]);

    setEmployee({ ...emp, companyName: company?.nama_perusahaan || null });
    setModuleKeys((mods || []).map((m) => m.module_name));
    setProfileIncomplete(missingFieldsForEmployee(master).length > 0);

    setLoading(false);
  }, [supabase, router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/employee/login');
    router.refresh();
  };

  const hasAccess = (key) => isModuleGranted({ isSuperadmin: !!employee?.is_superadmin, moduleKeys, key });
  const hasAnyAccess = (mod) => hasAccess(mod.key) || (mod.altKeys || []).some(hasAccess);
  // Widget kontrak berakhir: untuk HR yang mengelola data karyawan/payroll.
  const canSeeKontrakWidget = hasAccess('employee_list') || hasAccess('payroll');

  // Badge antrean persetujuan: hanya diminta kalau user punya minimal satu modul
  // approval, supaya karyawan biasa tidak memicu request sia-sia. Best-effort —
  // gagal = badge tidak tampil, dashboard tetap jalan. Dimuat ulang saat tab
  // kembali aktif supaya angka tidak basi kalau dashboard dibiarkan terbuka.
  const hasPendingQueueAccess = !!employee && PENDING_QUEUE_MODULES.some(hasAccess);
  useEffect(() => {
    if (!hasPendingQueueAccess) return undefined;

    let cancelled = false;
    let lastFetch = 0;
    const loadCounts = async () => {
      lastFetch = Date.now();
      try {
        const res = await fetch('/api/dashboard/pending-counts', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled) setPendingCounts(body.counts || {});
      } catch {
        // Diabaikan: badge cuma pelengkap.
      }
    };
    const onVisible = () => {
      // Jeda 30 detik supaya pindah-pindah tab tidak membanjiri endpoint.
      if (document.visibilityState === 'visible' && Date.now() - lastFetch > 30_000) loadCounts();
    };

    loadCounts();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
    // hasAccess/hasAnyAccess dibuat ulang tiap render; yang menentukan hasilnya
    // cuma employee + moduleKeys, jadi flag turunan hasPendingQueueAccess cukup.
  }, [hasPendingQueueAccess]);

  if (loading) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">{error}</p>
          <button
            onClick={handleLogout}
            className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Logout
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-[#F4F4F4]">
      <EmployeeHeader
        onLogout={handleLogout}
        left={
          <div>
            <p className="text-sm font-semibold text-black">{employee.nama}</p>
            <p className="text-xs text-[#6B6B6B]">
              {employee.companyName} {employee.is_superadmin && '· Superadmin'}
            </p>
          </div>
        }
        search={employee.is_superadmin ? <GlobalSearchBar /> : null}
      />

      <div className="max-w-[1100px] mx-auto px-6 py-10">
        <AnnouncementBanner supabase={supabase} employeeId={employee.id} clientId={employee.client_id} />

        {/* Layer 1 — Dashboard Saya: sama untuk semua karyawan (superadmin tetap karyawan aktif) */}
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-1">
          Dashboard Saya
        </h1>
        <p className="text-sm text-[#6B6B6B] mb-8">Profil, absensi, cuti, dan payslip kamu.</p>
        {hasAccess('absensi') && <QuickClockInCard employee={employee} />}
        <ModuleGrid
          modules={MODULE_REGISTRY.filter((m) => m.layer === 'personal')}
          hasAnyAccess={hasAnyAccess}
          attentionKeys={profileIncomplete ? ['profile'] : []}
        />

        {employee?.is_superadmin ? (
          <>
            {/* Layer 2 — My Work: semua modul yang sudah live (superadmin selalu punya akses penuh,
                termasuk Reports & Activity Log yang eksklusif superadmin) */}
            <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] mt-12 mb-1">
              My Work
            </h2>
            <p className="text-sm text-[#6B6B6B] mb-8">Semua modul kerja — akses penuh sebagai superadmin.</p>

            {canSeeKontrakWidget && <KontrakBerakhirWidget />}

            {(() => {
              const hrisModules = MODULE_REGISTRY.filter((m) => m.layer === 'hris' && m.status === 'live');
              const generalModules = MODULE_REGISTRY.filter((m) => m.layer === 'general' && m.status === 'live');

              return (
                <>
                  {hrisModules.length > 0 && (
                    <HrisFolder
                      employeeId={employee.id}
                      modules={hrisModules}
                      hasAnyAccess={hasAnyAccess}
                      badges={pendingCounts}
                    />
                  )}
                  <ModuleGrid modules={generalModules} hasAnyAccess={hasAnyAccess} />
                </>
              );
            })()}

            {/* Roadmap — modul yang belum live (in_progress/coming_soon), dipisah dari area
                kerja utama supaya grid "My Work" tetap bersih seiring registry makin panjang */}
            {(() => {
              const roadmapModules = MODULE_REGISTRY.filter((m) => m.status !== 'live');
              if (roadmapModules.length === 0) return null;

              return (
                <>
                  <h2 className="font-serif text-[22px] font-normal text-[#9A9A9A] tracking-[-0.02em] mt-12 mb-1">
                    Roadmap
                  </h2>
                  <p className="text-sm text-[#6B6B6B] mb-8">Modul yang sedang atau akan dibangun.</p>
                  <div className="border border-dashed border-[#D0D0D0] p-5">
                    <ModuleGrid modules={roadmapModules} hasAnyAccess={hasAnyAccess} isSuperadmin />
                  </div>
                </>
              );
            })()}
          </>
        ) : (
          <>
            {/* Layer 2 — My Work: modul kerjaan sesuai akses yang diberikan */}
            <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] mt-12 mb-1">
              My Work
            </h2>
            <p className="text-sm text-[#6B6B6B] mb-8">Modul kerjaan sesuai akses kamu.</p>

            {canSeeKontrakWidget && <KontrakBerakhirWidget />}

            {(() => {
              const hrisModules = MODULE_REGISTRY.filter((m) => m.layer === 'hris');
              const generalModules = MODULE_REGISTRY.filter((m) => m.layer === 'general');
              const showHris = hrisModules.some((m) => m.status === 'live' && hasAnyAccess(m));

              return (
                <>
                  {showHris && (
                    <HrisFolder
                      employeeId={employee.id}
                      modules={hrisModules}
                      hasAnyAccess={hasAnyAccess}
                      badges={pendingCounts}
                    />
                  )}
                  <ModuleGrid
                    modules={generalModules.filter((m) => m.status === 'live' && hasAnyAccess(m))}
                    hasAnyAccess={hasAnyAccess}
                  />
                </>
              );
            })()}
          </>
        )}
      </div>
    </section>
  );
}

// Lencana angka antrean persetujuan. Dibatasi 99+ supaya lebarnya tetap kecil.
function CountBadge({ count }) {
  const label = `${count} pengajuan menunggu persetujuan`;
  return (
    <span
      className="min-w-[22px] h-[22px] px-1.5 inline-flex items-center justify-center rounded-full bg-madael-red text-white text-[11px] font-medium leading-none"
      title={label}
      role="img"
      aria-label={label}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

const HRIS_OPEN_STORAGE_KEY = 'madael.dashboard.hrisOpen';

// Folder HRIS: terlipat bawaan, pilihan buka/tutup diingat di localStorage per
// akun (perangkat bersama tidak saling menimpa). Komponen ini hanya dirender
// setelah dashboard selesai dimuat di client, jadi membaca localStorage di
// initializer aman dari hydration mismatch. Akses storage dibungkus try/catch
// (mode privat / storage diblokir) — kalau gagal, folder tetap terlipat.
// Saat terlipat, kartu-kartunya tersembunyi, jadi total antrean ditampilkan di
// header supaya approver tetap tahu ada yang menunggu tanpa membuka folder.
function HrisFolder({ employeeId, modules, hasAnyAccess, badges }) {
  const storageKey = `${HRIS_OPEN_STORAGE_KEY}.${employeeId}`;
  const [open, setOpen] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(storageKey, next ? '1' : '0');
    } catch {
      // Diabaikan: status lipatan cuma preferensi tampilan.
    }
  };

  const total = modules
    .filter((m) => m.status === 'live' && hasAnyAccess(m))
    .reduce((sum, m) => sum + (badges[m.key] || 0), 0);
  const panelId = 'hris-folder-panel';

  return (
    <div className="border border-madael-red/30 bg-madael-red/5 mb-6">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full flex items-center justify-between gap-3 p-5 text-left"
      >
        <span className="text-xs font-medium tracking-[0.08em] text-madael-red">HRIS</span>
        <span className="flex items-center gap-3">
          {!open && total > 0 && <CountBadge count={total} />}
          <ChevronDown
            size={16}
            className={`text-madael-red transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </span>
      </button>
      {open && (
        <div id={panelId} className="px-5 pb-5">
          <ModuleGrid modules={modules} hasAnyAccess={hasAnyAccess} badges={badges} />
        </div>
      )}
    </div>
  );
}

function ModuleGrid({ modules, hasAnyAccess, isSuperadmin = false, attentionKeys = [], badges = {} }) {
  const visible = modules.filter((mod) => {
    const isLive = mod.status === 'live';
    const active = isLive && hasAnyAccess(mod);
    // Superadmin tetap lihat semua (termasuk locked/coming soon) sebagai roadmap.
    // Employee biasa cuma lihat modul yang benar-benar bisa dia akses.
    return isSuperadmin || active;
  });

  if (visible.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {visible.map((mod) => {
        const Icon = mod.icon;
        const isLive = mod.status === 'live';
        const active = isLive && hasAnyAccess(mod);
        const CardTag = active ? Link : 'div';
        const cardProps = active ? { href: mod.href } : {};

        return (
          <CardTag
            key={mod.href}
            {...cardProps}
            className={`block border p-5 transition-colors ${
              active
                ? 'bg-white border-[#E0E0E0] hover:border-madael-red cursor-pointer'
                : 'bg-[#FAFAFA] border-[#E0E0E0] cursor-not-allowed'
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <div
                className={`w-10 h-10 flex items-center justify-center ${
                  active ? 'bg-madael-red text-white' : 'bg-[#E0E0E0] text-[#9A9A9A]'
                }`}
              >
                <Icon size={18} />
              </div>
              {!isLive ? (
                <span className="text-[10px] font-medium tracking-[0.04em] px-2 py-1 bg-[#E0E0E0] text-[#6B6B6B]">
                  COMING SOON
                </span>
              ) : !active ? (
                <Lock size={14} className="text-[#9A9A9A]" />
              ) : badges[mod.key] > 0 ? (
                <CountBadge count={badges[mod.key]} />
              ) : attentionKeys.includes(mod.key) ? (
                <span
                  className="w-2.5 h-2.5 rounded-full bg-madael-red mt-1"
                  title="Data profil belum lengkap"
                  role="img"
                  aria-label="Data profil belum lengkap"
                />
              ) : null}
            </div>
            <p className={`text-sm font-medium mb-1 ${active ? 'text-black' : 'text-[#9A9A9A]'}`}>
              {mod.name}
            </p>
            <p className="text-xs text-[#6B6B6B]">{mod.desc}</p>
          </CardTag>
        );
      })}
    </div>
  );
}