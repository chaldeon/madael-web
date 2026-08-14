'use client';

import GlobalSearchBar from '@/components/GlobalSearchBar';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { MODULE_REGISTRY } from '@/lib/employeeModules';
import EmployeeHeader from '@/components/EmployeeHeader';

export default function EmployeeDashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [employee, setEmployee] = useState(null);
  const [moduleKeys, setModuleKeys] = useState([]);
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
    // sampai memblokir login (beda dari cek di atas yang memang wajib).
    let companyName = null;
    if (emp.client_id) {
      const { data: company } = await supabase
        .from('companies')
        .select('nama_perusahaan')
        .eq('id', emp.client_id)
        .maybeSingle();
      companyName = company?.nama_perusahaan || null;
    }

    setEmployee({ ...emp, companyName });

    if (!emp.is_superadmin) {
      const { data: mods } = await supabase
        .from('employee_modules')
        .select('module_name')
        .eq('employee_id', emp.id);
      setModuleKeys((mods || []).map((m) => m.module_name));
    }

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

  const hasAccess = (key) => employee?.is_superadmin || moduleKeys.includes(key);
  const hasAnyAccess = (mod) => hasAccess(mod.key) || (mod.altKeys || []).some(hasAccess);

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
        {employee?.is_superadmin ? (
          <>
            <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-1">
              Dashboard
            </h1>
            <p className="text-sm text-[#6B6B6B] mb-8">Pilih modul yang ingin kamu akses.</p>
            <ModuleGrid modules={MODULE_REGISTRY} hasAnyAccess={hasAnyAccess} isSuperadmin />
          </>
        ) : (
          <>
            {/* Layer 1 — Dashboard Saya: sama untuk semua karyawan */}
            <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-1">
              Dashboard Saya
            </h1>
            <p className="text-sm text-[#6B6B6B] mb-8">Absensi, cuti, dan payslip kamu.</p>
            <ModuleGrid
              modules={MODULE_REGISTRY.filter((m) => m.layer === 'personal')}
              hasAnyAccess={hasAnyAccess}
            />

            {/* Layer 2 — My Work: modul kerjaan sesuai akses yang diberikan */}
            <h2 className="font-serif text-[22px] font-normal text-black tracking-[-0.02em] mt-12 mb-1">
              My Work
            </h2>
            <p className="text-sm text-[#6B6B6B] mb-8">Modul kerjaan sesuai akses kamu.</p>

            {(() => {
              const hrisModules = MODULE_REGISTRY.filter((m) => m.layer === 'hris');
              const generalModules = MODULE_REGISTRY.filter((m) => m.layer === 'general');
              const showHris = hrisModules.some((m) => m.status === 'live' && hasAnyAccess(m));

              return (
                <>
                  {showHris && (
                    <div className="border border-madael-red/30 bg-madael-red/5 p-5 mb-6">
                      <p className="text-xs font-medium tracking-[0.08em] text-madael-red mb-4">
                        HRIS
                      </p>
                      <ModuleGrid modules={hrisModules} hasAnyAccess={hasAnyAccess} />
                    </div>
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

function ModuleGrid({ modules, hasAnyAccess, isSuperadmin = false }) {
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