'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

export function useModuleAccess(moduleKey) {
  const router = useRouter();
  const supabase = createClient();

  const [status, setStatus] = useState('loading'); // 'loading' | 'allowed' | 'denied'
  const [employee, setEmployee] = useState(null);

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

    const { data: mod } = await supabase
      .from('employee_modules')
      .select('module_name')
      .eq('employee_id', emp.id)
      .eq('module_name', moduleKey)
      .maybeSingle();

    setStatus(mod ? 'allowed' : 'denied');
  }, [supabase, router, moduleKey]);

  useEffect(() => {
    check();
  }, [check]);

  return { status, employee };
}