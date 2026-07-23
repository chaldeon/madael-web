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
      .select('id, nama, email, perusahaan, status, is_superadmin')
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

    setEmployee(emp);

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
              {employee.perusahaan} {employee.is_superadmin && '· Superadmin'}
            </p>
          </div>
        }
        search={employee.is_superadmin ? <GlobalSearchBar /> : null}
      />

      <div className="max-w-[1100px] mx-auto px-6 py-10">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em] mb-1">
          Dashboard
        </h1>
        <p className="text-sm text-[#6B6B6B] mb-8">Pilih modul yang ingin kamu akses.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULE_REGISTRY
            .filter((mod) => {
              const isLive = mod.status === 'live';
              const active = isLive && hasAnyAccess(mod);
              // Superadmin tetap lihat semua (termasuk locked/coming soon) sebagai roadmap.
              // Employee biasa cuma lihat modul yang benar-benar bisa dia akses.
              return employee?.is_superadmin || active;
            })
            .map((mod) => {
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
      </div>
    </section>
  );
}