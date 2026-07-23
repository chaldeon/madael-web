'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Search, User, FileText, Receipt } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

// Search bar global untuk dashboard superadmin — cari lintas employee,
// invoice (Task 16, tabel opsional), dan dokumen (Document Generator).
// Belum ada halaman detail per-employee/per-invoice di codebase ini, jadi
// hasil employee/invoice diarahkan ke halaman list masing-masing, bukan
// deep-link ke row spesifik. Dokumen sudah punya detail route asli.
export default function GlobalSearchBar() {
  const supabase = createClient();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState({ employees: [], invoices: [], documents: [] });
  const [searchError, setSearchError] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const runSearch = useCallback(async (q) => {
    setLoading(true);
    setSearchError(null);

    const [empRes, invRes, docRes] = await Promise.all([
      supabase
        .from('employees')
        .select('id, nama, employee_id, perusahaan')
        .or(`nama.ilike.%${q}%,employee_id.ilike.%${q}%`)
        .limit(5),
      // invoices — tabel opsional (Task 16). Kalau belum ada di environment
      // ini, empRes/docRes tetap jalan normal, cuma hasil invoice kosong.
      supabase
        .from('invoices')
        .select('id, nomor_surat, nominal')
        .ilike('nomor_surat', `%${q}%`)
        .limit(5),
      supabase
        .from('documents')
        .select('id, nomor_surat, judul')
        .ilike('nomor_surat', `%${q}%`)
        .limit(5),
    ]);

    setResults({
      employees: empRes.error ? [] : (empRes.data || []),
      invoices: invRes.error ? [] : (invRes.data || []),
      documents: docRes.error ? [] : (docRes.data || []),
    });

    // Kalau employees & documents (dua-duanya tabel wajib) gagal, itu baru
    // dianggap error beneran — invoices sengaja tidak dihitung karena opsional.
    setSearchError(empRes.error && docRes.error ? 'Gagal melakukan pencarian.' : null);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults({ employees: [], invoices: [], documents: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const totalResults = results.employees.length + results.invoices.length + results.documents.length;
  const showDropdown = open && query.trim().length >= MIN_QUERY_LENGTH;

  return (
    <div className="relative w-full max-w-[320px]" ref={wrapRef}>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9A9A9A]" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Cari employee, invoice, dokumen..."
          className="w-full border border-[#E0E0E0] pl-8 pr-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
        />
      </div>

      {showDropdown && (
        <div className="absolute left-0 top-full mt-2 w-[360px] max-w-[90vw] bg-white border border-[#E0E0E0] shadow-lg z-[1000] max-h-[420px] overflow-y-auto">
          {loading ? (
            <p className="text-xs text-[#9A9A9A] text-center py-8">Mencari...</p>
          ) : searchError ? (
            <p className="text-xs text-madael-red text-center py-8">{searchError}</p>
          ) : totalResults === 0 ? (
            <p className="text-xs text-[#9A9A9A] text-center py-8">Tidak ada hasil untuk &quot;{query.trim()}&quot;.</p>
          ) : (
            <>
              {results.employees.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-medium tracking-[0.04em] text-[#9A9A9A] uppercase">Employee</p>
                  {results.employees.map((e) => (
                    <Link
                      key={e.id}
                      href="/employee/list"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#FAFAFA] no-underline transition-colors"
                    >
                      <User size={14} className="text-[#9A9A9A] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-black truncate">{e.nama}</p>
                        <p className="text-[10px] text-[#9A9A9A] truncate">{e.employee_id || '—'} · {e.perusahaan || '—'}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {results.invoices.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-medium tracking-[0.04em] text-[#9A9A9A] uppercase border-t border-[#F0F0F0]">Invoice</p>
                  {results.invoices.map((i) => (
                    <Link
                      key={i.id}
                      href="/employee/documents/invoices"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#FAFAFA] no-underline transition-colors"
                    >
                      <Receipt size={14} className="text-[#9A9A9A] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-black truncate">{i.nomor_surat}</p>
                        <p className="text-[10px] text-[#9A9A9A] truncate">
                          {i.nominal ? `Rp ${Math.round(i.nominal).toLocaleString('id-ID')}` : '—'}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              {results.documents.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-medium tracking-[0.04em] text-[#9A9A9A] uppercase border-t border-[#F0F0F0]">Dokumen</p>
                  {results.documents.map((d) => (
                    <Link
                      key={d.id}
                      href={`/employee/documents/${d.id}`}
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#FAFAFA] no-underline transition-colors"
                    >
                      <FileText size={14} className="text-[#9A9A9A] shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs text-black truncate">{d.nomor_surat}</p>
                        <p className="text-[10px] text-[#9A9A9A] truncate">{d.judul || '—'}</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}