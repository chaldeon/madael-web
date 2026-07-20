'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Pencil, X, ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

const STATUS_STYLES = {
  Draft: 'bg-[#F3F4F6] text-[#4B5563]',
  Final: 'bg-[#E8F0FE] text-[#1A56DB]',
  Terkirim: 'bg-[#FEF3C7] text-[#92700C]',
  Ditandatangani: 'bg-[#DCFCE7] text-[#166534]',
};

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

function EditCounterModal({ counter, onClose, onSave, saving }) {
  const [value, setValue] = useState(counter.last_number);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[999] px-4">
      <div className="bg-white w-full max-w-[400px] p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-serif text-lg text-black">Koreksi Nomor — {counter.nama}</h2>
          <button onClick={onClose} className="text-[#6B6B6B] hover:text-black">
            <X size={18} />
          </button>
        </div>

        <label className="flex flex-col gap-1 mb-5">
          <span className="text-xs text-[#6B6B6B]">Nomor terakhir dipakai ({counter.kode})</span>
          <input
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value === '' ? 0 : Number(e.target.value))}
            className="border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors"
          />
        </label>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-medium text-[#4B5563] hover:text-black transition-colors"
          >
            Batal
          </button>
          <button
            onClick={() => onSave(value)}
            disabled={saving}
            className="bg-madael-red text-white px-5 py-2.5 text-sm font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors disabled:opacity-60"
          >
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NomorSuratPage() {
  const router = useRouter();
  const supabase = createClient();

  const [authorized, setAuthorized] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [counters, setCounters] = useState([]);
  const [recentDocs, setRecentDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  const [editingCounter, setEditingCounter] = useState(null);
  const [saving, setSaving] = useState(false);

  const checkAccess = useCallback(async () => {
    setAuthLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/employee/login');
      return;
    }
    const { data: emp } = await supabase
      .from('employees')
      .select('is_superadmin, status')
      .eq('email', user.email)
      .maybeSingle();

    if (!emp || !emp.is_superadmin || emp.status !== 'Aktif') {
      setAuthError('Halaman ini khusus untuk superadmin.');
      setAuthLoading(false);
      return;
    }
    setAuthorized(true);
    setAuthLoading(false);
  }, [supabase, router]);

  useEffect(() => { checkAccess(); }, [checkAccess]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: cnt }, { data: docs }] = await Promise.all([
      supabase
        .from('document_counters')
        .select('id, kode, nama, last_number')
        .order('kode', { ascending: true }),
      supabase
        .from('documents')
        .select('id, nomor_surat, judul, kode_jenis, status, created_at, employees:created_by ( nama )')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    setCounters(cnt || []);
    setRecentDocs(docs || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (authorized) loadData();
  }, [authorized, loadData]);

  const handleSaveCounter = async (newValue) => {
    setSaving(true);
    const { error } = await supabase
      .from('document_counters')
      .update({ last_number: newValue })
      .eq('id', editingCounter.id);
    setSaving(false);

    if (error) {
      alert('Gagal update nomor: ' + error.message);
      return;
    }
    setEditingCounter(null);
    loadData();
  };

  if (authLoading) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <p className="text-sm text-[#6B6B6B]">Memuat...</p>
      </section>
    );
  }

  if (authError) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">{authError}</p>
          <Link
            href="/employee/dashboard"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali ke Dashboard
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-10">
      <Link href="/employee/documents" className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-madael-red transition-colors mb-6">
        <ArrowLeft size={15} />
        Kembali ke Dokumen
      </Link>

      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Nomor Surat</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">Halaman referensi — monitor dan koreksi counter. Bukan untuk generate dokumen.</p>
      </div>

      {loading ? (
        <p className="text-sm text-[#6B6B6B]">Memuat data...</p>
      ) : (
        <>
          <div className="bg-white border border-[#E0E0E0] mb-10 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E0E0E0] text-left text-[#6B6B6B]">
                  <th className="px-4 py-3 font-medium">Kode</th>
                  <th className="px-4 py-3 font-medium">Jenis Dokumen</th>
                  <th className="px-4 py-3 font-medium">Nomor Terakhir</th>
                  <th className="px-4 py-3 font-medium">Nomor Berikutnya</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {counters.map((c) => (
                  <tr key={c.id} className="border-b border-[#F0F0F0] last:border-0">
                    <td className="px-4 py-3 font-medium text-black">{c.kode}</td>
                    <td className="px-4 py-3 text-black">{c.nama}</td>
                    <td className="px-4 py-3 text-black">{String(c.last_number).padStart(3, '0')}</td>
                    <td className="px-4 py-3 text-black">{String(c.last_number + 1).padStart(3, '0')}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setEditingCounter(c)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4B5563] hover:text-madael-red transition-colors"
                      >
                        <Pencil size={13} />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {counters.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-[#9A9A9A]">Belum ada data counter.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-black mb-3">10 Dokumen Terbaru</h2>
            <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E0E0E0] text-left text-[#6B6B6B]">
                    <th className="px-4 py-3 font-medium">Nomor Surat</th>
                    <th className="px-4 py-3 font-medium">Judul</th>
                    <th className="px-4 py-3 font-medium">Jenis</th>
                    <th className="px-4 py-3 font-medium">Dibuat Oleh</th>
                    <th className="px-4 py-3 font-medium">Tanggal</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDocs.map((d) => (
                    <tr key={d.id} className="border-b border-[#F0F0F0] last:border-0">
                      <td className="px-4 py-3 font-medium text-black whitespace-nowrap">{d.nomor_surat}</td>
                      <td className="px-4 py-3 text-black">{d.judul}</td>
                      <td className="px-4 py-3 text-black">{d.kode_jenis}</td>
                      <td className="px-4 py-3 text-black">{d.employees?.nama || '-'}</td>
                      <td className="px-4 py-3 text-black whitespace-nowrap">{formatDate(d.created_at)}</td>
                      <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                    </tr>
                  ))}
                  {recentDocs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-[#9A9A9A]">Belum ada dokumen.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {editingCounter && (
        <EditCounterModal
          counter={editingCounter}
          onClose={() => setEditingCounter(null)}
          onSave={handleSaveCounter}
          saving={saving}
        />
      )}
    </div>
  );
}