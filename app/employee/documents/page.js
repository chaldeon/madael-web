'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Plus, ChevronDown, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

const JENIS_OPTIONS = [
  { kode: 'PRO', label: 'Proposal' },
  { kode: 'QUO', label: 'Quotation' },
  { kode: 'PROQUO', label: 'Proposal & Quotation' },
  { kode: 'AGR', label: 'Agreement' },
  { kode: 'ADM', label: 'Administrasi' },
  { kode: 'INV', label: 'Invoice' },
];

const STATUS_OPTIONS = ['Draft', 'Final', 'Terkirim', 'Ditandatangani'];

const JENIS_STYLES = {
  PRO: 'bg-[#E8F0FE] text-[#1A56DB]',
  QUO: 'bg-[#EDE9FE] text-[#6D28D9]',
  PROQUO: 'bg-[#FCE7F3] text-[#BE185D]',
  AGR: 'bg-[#FFEDD5] text-[#C2410C]',
  ADM: 'bg-[#F3F4F6] text-[#4B5563]',
  INV: 'bg-[#DCFCE7] text-[#166534]',
};

const STATUS_STYLES = {
  Draft: 'bg-[#F3F4F6] text-[#4B5563]',
  Final: 'bg-[#E8F0FE] text-[#1A56DB]',
  Terkirim: 'bg-[#FEF3C7] text-[#92700C]',
  Ditandatangani: 'bg-[#DCFCE7] text-[#166534]',
};

function JenisBadge({ kode }) {
  const label = JENIS_OPTIONS.find((j) => j.kode === kode)?.label || kode;
  return (
    <span className={`inline-block px-2.5 py-1 text-[11px] font-medium rounded ${JENIS_STYLES[kode] || 'bg-[#F3F4F6] text-[#4B5563]'}`}>
      {label}
    </span>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-block px-2.5 py-1 text-[11px] font-medium rounded ${STATUS_STYLES[status] || 'bg-[#F3F4F6] text-[#4B5563]'}`}>
      {status}
    </span>
  );
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

function NewDocumentDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors"
      >
        <Plus size={16} />
        Buat Dokumen Baru
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-white border border-[#E0E0E0] shadow-lg z-10">
          {JENIS_OPTIONS.filter((j) => j.kode !== 'INV').map((j) => (
            <Link
              key={j.kode}
              href={`/employee/documents/new?type=${j.kode}`}
              className="block px-4 py-2.5 text-sm text-black hover:bg-[#F4F4F4] transition-colors"
            >
              {j.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocumentsListPage() {
  const supabase = createClient();

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [filterJenis, setFilterJenis] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('documents')
      .select('id, created_at, nomor_surat, judul, kode_jenis, status, tanggal_dokumen, clients:client_id ( id, nama_perusahaan ), employees:created_by ( id, nama )')
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setDocuments(data || []);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const filtered = useMemo(() => {
    return documents.filter((d) => {
      const matchJenis = !filterJenis || d.kode_jenis === filterJenis;
      const matchStatus = !filterStatus || d.status === filterStatus;
      return matchJenis && matchStatus;
    });
  }, [documents, filterJenis, filterStatus]);

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-10">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Dokumen</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">{documents.length} total dokumen</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/employee/documents/nomor-surat"
            className="flex items-center gap-1.5 text-sm text-[#4B5563] hover:text-madael-red transition-colors"
          >
            <ExternalLink size={14} />
            Nomor Surat
          </Link>
          <NewDocumentDropdown />
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={filterJenis}
          onChange={(e) => setFilterJenis(e.target.value)}
          className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
        >
          <option value="">Semua Jenis</option>
          {JENIS_OPTIONS.map((j) => (
            <option key={j.kode} value={j.kode}>{j.label}</option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
        >
          <option value="">Semua Status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {error && (
        <p className="text-sm text-madael-red mb-4">Gagal memuat data: {error}</p>
      )}

      {loading ? (
        <p className="text-sm text-[#6B6B6B]">Memuat data...</p>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Nomor Surat</th>
                <th className="px-4 py-3 font-medium">Judul</th>
                <th className="px-4 py-3 font-medium">Jenis</th>
                <th className="px-4 py-3 font-medium">Klien</th>
                <th className="px-4 py-3 font-medium">Dibuat Oleh</th>
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr
                  key={d.id}
                  className="border-b border-[#F0F0F0] last:border-0 hover:bg-[#FAFAFA] cursor-pointer transition-colors"
                  onClick={() => { window.location.href = `/employee/documents/${d.id}`; }}
                >
                  <td className="px-4 py-3 font-medium text-black whitespace-nowrap">{d.nomor_surat}</td>
                  <td className="px-4 py-3 text-black">{d.judul}</td>
                  <td className="px-4 py-3"><JenisBadge kode={d.kode_jenis} /></td>
                  <td className="px-4 py-3 text-black">{d.clients?.nama_perusahaan || '-'}</td>
                  <td className="px-4 py-3 text-black">{d.employees?.nama || '-'}</td>
                  <td className="px-4 py-3 text-black whitespace-nowrap">{formatDate(d.tanggal_dokumen)}</td>
                  <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[#9A9A9A]">Belum ada dokumen.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}