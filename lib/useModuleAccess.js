'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

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
      .select('id, nama, perusahaan, is_superadmin, status')
      .eq('email', user.email)
      .maybeSingle();

    if (!emp || emp.status !== 'Aktif') {
      router.push('/employee/dashboard');
      return;
    }

    setEmployee(emp);

    if (emp.is_superadmin) {
      setStatus('allowed');
      return;
    }

    const { data: mods } = await supabase
      .from('employee_modules')
      .select('module_name')
      .eq('employee_id', emp.id);

    const keys = (mods || []).map((m) => m.module_name);
    setModuleKeys(keys);

    const allowed = requiredKeysDep.split(',').some((k) => keys.includes(k));
    setStatus(allowed ? 'allowed' : 'denied');
  }, [supabase, router, requiredKeysDep]);

  useEffect(() => {
    check();
  }, [check]);

  // Cek key spesifik lain di luar gate utama layout — dipakai buat
  // tampil/sembunyikan tab sub-menu. Superadmin selalu lolos.
  const hasModule = (key) => !!employee?.is_superadmin || moduleKeys.includes(key);

  return { status, employee, moduleKeys, hasModule };
}
