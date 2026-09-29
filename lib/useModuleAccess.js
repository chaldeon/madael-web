'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { EXPLICIT_ONLY_MODULES, isModuleGranted } from '@/lib/employeeModules';

// moduleKey: string atau array of string — employee lolos kalau superadmin
// ATAU punya SALAH SATU dari key yang diminta (dipakai layout yang punya
// beberapa sub-halaman dengan permission granular berbeda, mis. absensi vs
// absensi_jadwal).
export function useModuleAccess(moduleKey) {
  const router = useRouter();
  const supabase = createClient();

  const [status, setStatus] = useState('loading'); // 'loading' | 'allowed' | 'denied'
  const [employee, setEmployee] = useState(null);
  const [moduleKeys, setModuleKeys] = useState([]);

  const requiredKeys = Array.isArray(moduleKey) ? moduleKey : [moduleKey];
  const requiredKeysDep = requiredKeys.join(',');

  const check = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/employee/login');
      return;
    }

    const { data: emp } = await supabase
      .from('employees')
      .select('id, nama, is_superadmin, status')
      .eq('email', user.email)
      .maybeSingle();

    if (!emp || emp.status !== 'Aktif') {
      router.push('/employee/dashboard');
      return;
    }

    setEmployee(emp);

    // Superadmin bypass semua modul kecuali EXPLICIT_ONLY_MODULES (mis.
    // support_access) — untuk mereka cukup ambil baris explicit-only saja.
    let modsQuery = supabase
      .from('employee_modules')
      .select('module_name')
      .eq('employee_id', emp.id);
    if (emp.is_superadmin) modsQuery = modsQuery.in('module_name', EXPLICIT_ONLY_MODULES);
    const { data: mods } = await modsQuery;

    const keys = (mods || []).map((m) => m.module_name);
    setModuleKeys(keys);

    const allowed = requiredKeysDep
      .split(',')
      .some((k) => isModuleGranted({ isSuperadmin: emp.is_superadmin, moduleKeys: keys, key: k }));
    setStatus(allowed ? 'allowed' : 'denied');
  }, [supabase, router, requiredKeysDep]);

  useEffect(() => {
    check();
  }, [check]);

  // Cek key spesifik lain di luar gate utama layout — dipakai buat
  // tampil/sembunyikan tab sub-menu. Superadmin lolos, kecuali key explicit-only.
  const hasModule = (key) => isModuleGranted({ isSuperadmin: !!employee?.is_superadmin, moduleKeys, key });

  return { status, employee, moduleKeys, hasModule };
}