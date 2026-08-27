'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

// Field payroll yang dianggap "penting" untuk keperluan Fase 2.1 seksi 3 —
// kalau salah satu kosong pada baris yang SUDAH ter-link, baris itu masih
// dianggap belum lengkap meskipun sudah tersambung ke akun absensi.
function missingImportantFields(row) {
  const missing = [];
  if (!row.status_ptkp) missing.push('Status PTKP');
  if (!row.npwp_status) missing.push('Status NPWP');
  if (row.jkk_rate === null || row.jkk_rate === undefined || row.jkk_rate === '') missing.push('Tingkat Risiko JKK');
  if (!row.nama_rekening || !row.no_rekening) missing.push('Rekening (nama/nomor)');
  return missing;
}

function Section({ title, description, count, children }) {
  return (
    <div className="bg-white border border-[#E0E0E0] mb-6">
      <div className="px-6 py-4 border-b border-[#E0E0E0] flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-black">{title}</h2>
          <p className="text-xs text-[#6B6B6B] mt-1">{description}</p>
        </div>
        <span
          className={`shrink-0 text-[11px] font-medium px-2.5 py-1 rounded ${
            count > 0 ? 'bg-amber-100 text-amber-800' : 'bg-[#E6F4EA] text-[#1E7A34]'
          }`}
        >
          {count} {count === 1 ? 'item' : 'items'}
        </span>
      </div>
      <div className="px-6 py-4">{children}</div>
    </div>
  );
}

export default function DataAuditPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [employees, setEmployees] = useState([]);
  const [scheduledIds, setScheduledIds] = useState(new Set());
  const [employeesMaster, setEmployeesMaster] = useState([]);
  const [clients, setClients] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const [empRes, scheduleRes, masterRes, clientRes] = await Promise.all([
      supabase.from('employees').select('id, nama, status'),
      supabase.from('work_schedule').select('employee_id'),
      supabase
        .from('employees_master')
        .select('id, nama, client_id, linked_employee_id, status_ptkp, npwp_status, jkk_rate, nama_rekening, no_rekening, created_at, employees:linked_employee_id ( nama, status )')
        .order('created_at', { ascending: false }),
      supabase.from('companies').select('id, nama_perusahaan'),
    ]);

    const firstError = empRes.error || scheduleRes.error || masterRes.error || clientRes.error;
    if (firstError) {
      setLoadError(firstError.message || 'Gagal memuat data audit.');
      setLoading(false);
      return;
    }

    setEmployees(empRes.data || []);
    setScheduledIds(new Set((scheduleRes.data || []).map((r) => r.employee_id)));
    setEmployeesMaster(masterRes.data || []);
    setClients(clientRes.data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const clientName = (id) => clients.find((c) => c.id === id)?.nama_perusahaan || '—';

  // Seksi 1 — akun Aktif tanpa Jadwal Kerja.
  const akunTanpaJadwal = useMemo(
    () => employees.filter((e) => e.status === 'Aktif' && !scheduledIds.has(e.id)),
    [employees, scheduledIds]
  );

  // Seksi 2 — baris payroll tanpa akun absensi ter-link.
  const masterTanpaLink = useMemo(
    () => employeesMaster.filter((m) => !m.linked_employee_id),
    [employeesMaster]
  );

  // Seksi 3 — ter-link tapi field penting masih kosong.
  const masterFieldKosong = useMemo(
    () =>
      employeesMaster
        .filter((m) => m.linked_employee_id)
        .map((m) => ({ row: m, missing: missingImportantFields(m) }))
        .filter((x) => x.missing.length > 0),
    [employeesMaster]
  );

  // Seksi 4 — ter-link ke akun yang sudah Nonaktif.
  const masterLinkedNonaktif = useMemo(
    () => employeesMaster.filter((m) => m.linked_employee_id && m.employees?.status === 'Nonaktif'),
    [employeesMaster]
  );

  // Fase 2.2 — akun yang dipakai lebih dari satu baris employees_master.
  const duplicateLinks = useMemo(() => {
    const groups = {};
    employeesMaster.forEach((m) => {
      if (!m.linked_employee_id) return;
      if (!groups[m.linked_employee_id]) groups[m.linked_employee_id] = [];
      groups[m.linked_employee_id].push(m);
    });
    return Object.values(groups).filter((rows) => rows.length > 1);
  }, [employeesMaster]);

  // Fase 2.3 — nama di akun vs nama di payroll berbeda (case/whitespace
  // insensitive, bukan fuzzy match — sesuai keputusan di TODO).
  const namaDrift = useMemo(
    () =>
      employeesMaster.filter((m) => {
        if (!m.linked_employee_id || !m.employees?.nama || !m.nama) return false;
        return m.employees.nama.trim().toLowerCase() !== m.nama.trim().toLowerCase();
      }),
    [employeesMaster]
  );

  if (loadError) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">
          Kelengkapan Data Karyawan
        </h1>
        <p className="text-sm text-[#6B6B6B] mt-1">
          Audit read-only lintas modul Employee List, Payroll, dan Jadwal Kerja — sekali buka, langsung
          kelihatan gap tanpa perlu cek baris satu-satu.
        </p>
      </div>

      {loading ? (
        <LoadingState label="Memuat data audit..." />
      ) : (
        <>
          <Section
            title="Akun Aktif tanpa Jadwal Kerja"
            description="Akun absensi Aktif yang belum punya baris work_schedule sama sekali — penalty telat akan dianggap Rp0 sampai jadwal diisi."
            count={akunTanpaJadwal.length}
          >
            {akunTanpaJadwal.length === 0 ? (
              <EmptyState message="Semua akun Aktif sudah punya Jadwal Kerja." />
            ) : (
              <ul className="text-sm text-black flex flex-col gap-2">
                {akunTanpaJadwal.map((e) => (
                  <li key={e.id} className="flex items-center justify-between">
                    <span>{e.nama}</span>
                    <Link
                      href="/employee/absensi/karyawan"
                      className="text-xs text-madael-red hover:text-madael-dark font-medium"
                    >
                      Isi Jadwal →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Payroll tanpa Akun Absensi"
            description="Baris employees_master yang belum di-link ke akun manapun — sah untuk employee payroll-only, tapi kalau bukan, sisa cuti & penalty telat tidak akan terhitung."
            count={masterTanpaLink.length}
          >
            {masterTanpaLink.length === 0 ? (
              <EmptyState message="Semua baris payroll sudah ter-link ke akun." />
            ) : (
              <ul className="text-sm text-black flex flex-col gap-2">
                {masterTanpaLink.map((m) => (
                  <li key={m.id} className="flex items-center justify-between">
                    <span>{m.nama} <span className="text-[#9A9A9A]">({clientName(m.client_id)})</span></span>
                    <Link
                      href={`/employee/payroll/${m.id}`}
                      className="text-xs text-madael-red hover:text-madael-dark font-medium"
                    >
                      Detail →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Ter-link tapi Field Penting Kosong"
            description="Sudah terhubung ke akun, tapi status PTKP, status NPWP, JKK, atau rekening masih kosong."
            count={masterFieldKosong.length}
          >
            {masterFieldKosong.length === 0 ? (
              <EmptyState message="Semua baris ter-link sudah lengkap field pentingnya." />
            ) : (
              <ul className="text-sm text-black flex flex-col gap-2">
                {masterFieldKosong.map(({ row, missing }) => (
                  <li key={row.id} className="flex items-center justify-between gap-4">
                    <span>
                      {row.employees?.nama || row.nama}
                      <span className="text-[#9A9A9A]"> — kosong: {missing.join(', ')}</span>
                    </span>
                    <Link
                      href={`/employee/payroll/${row.id}`}
                      className="shrink-0 text-xs text-madael-red hover:text-madael-dark font-medium"
                    >
                      Lengkapi →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Ter-link ke Akun Nonaktif"
            description="Baris payroll yang linked_employee_id-nya menunjuk ke akun berstatus Nonaktif — kandidat karyawan resign yang masih berisiko ikut Payroll Run berikutnya kalau belum diarsipkan (lihat Fase 1.4 dan 4.3)."
            count={masterLinkedNonaktif.length}
          >
            {masterLinkedNonaktif.length === 0 ? (
              <EmptyState message="Tidak ada baris payroll yang ter-link ke akun Nonaktif." />
            ) : (
              <ul className="text-sm text-black flex flex-col gap-2">
                {masterLinkedNonaktif.map((m) => (
                  <li key={m.id} className="flex items-center justify-between">
                    <span>{m.employees?.nama || m.nama} <span className="text-[#9A9A9A]">({clientName(m.client_id)})</span></span>
                    <Link
                      href={`/employee/payroll/${m.id}`}
                      className="text-xs text-madael-red hover:text-madael-dark font-medium"
                    >
                      Detail →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Akun Dobel-link (Fase 2.2)"
            description="Satu akun absensi dipakai lebih dari satu baris payroll — kemungkinan besar akibat celah sebelum quick-win Fase 1.1 diterapkan. Perlu direview manual, bukan auto-merge (lihat Fase 4.1)."
            count={duplicateLinks.length}
          >
            {duplicateLinks.length === 0 ? (
              <EmptyState message="Tidak ada akun yang dobel-link." />
            ) : (
              <div className="flex flex-col gap-4">
                {duplicateLinks.map((rows, idx) => (
                  <div key={idx} className="border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-xs text-amber-800 mb-2 flex items-center gap-1.5">
                      <AlertTriangle size={12} />
                      Akun <span className="font-medium">{rows[0].employees?.nama || '—'}</span> dipakai di {rows.length} baris payroll:
                    </p>
                    <ul className="text-sm text-black flex flex-col gap-1">
                      {rows.map((m) => (
                        <li key={m.id} className="flex items-center justify-between">
                          <span>{m.nama} <span className="text-[#9A9A9A]">({clientName(m.client_id)})</span></span>
                          <Link
                            href={`/employee/payroll/${m.id}`}
                            className="text-xs text-madael-red hover:text-madael-dark font-medium"
                          >
                            Detail →
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Nama Drift (Fase 2.3)"
            description="Nama di akun (Employee List) berbeda dengan nama di baris payroll untuk pasangan yang sama — Employee List adalah sumber kebenaran (lihat Fase 1.3/4.2)."
            count={namaDrift.length}
          >
            {namaDrift.length === 0 ? (
              <EmptyState message="Tidak ada perbedaan nama antara akun dan payroll." />
            ) : (
              <ul className="text-sm text-black flex flex-col gap-2">
                {namaDrift.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-4">
                    <span>
                      Akun: <span className="font-medium">{m.employees?.nama}</span>
                      <span className="text-[#9A9A9A]"> vs </span>
                      Payroll: <span className="font-medium">{m.nama}</span>
                    </span>
                    <Link
                      href={`/employee/payroll/${m.id}`}
                      className="shrink-0 text-xs text-madael-red hover:text-madael-dark font-medium"
                    >
                      Detail →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}