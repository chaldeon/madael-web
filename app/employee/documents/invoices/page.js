'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { useModuleAccess } from '@/lib/useModuleAccess';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

const STATUS_OPTIONS = ['draft', 'terkirim', 'lunas'];
const STATUS_LABEL = { draft: 'Draft', terkirim: 'Terkirim', lunas: 'Lunas' };
const STATUS_STYLES = {
  draft: 'bg-[#F3F4F6] text-[#4B5563]',
  terkirim: 'bg-[#FEF3C7] text-[#92700C]',
  lunas: 'bg-[#DCFCE7] text-[#166534]',
};

function formatRupiah(value) {
  return 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
}

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-block px-2.5 py-1 text-[11px] font-medium rounded ${STATUS_STYLES[status] || 'bg-[#F3F4F6] text-[#4B5563]'}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

const emptyForm = { clientId: '', nomorSurat: '', nominal: '', tanggalTerbit: todayValue(), catatan: '' };

export default function InvoiceTrackerPage() {
  const supabase = createClient();
  const { status, employee } = useModuleAccess(['document_generator', 'nomor_surat']);
  const isSuperadmin = !!employee?.is_superadmin;

  const [statusFilter, setStatusFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [clients, setClients] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [updatingId, setUpdatingId] = useState(null);
  const [updateError, setUpdateError] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const [clientRes, invRes] = await Promise.all([
      supabase.from('clients').select('id, nama_perusahaan').eq('is_active', true).order('nama_perusahaan'),
      supabase.from('invoices').select('*').order('tanggal_terbit', { ascending: false }),
    ]);

    const firstError = clientRes.error || invRes.error;
    if (firstError) {
      setLoadError(firstError.message || 'Gagal memuat data invoice.');
      setLoading(false);
      return;
    }

    setClients(clientRes.data || []);
    setInvoices(invRes.data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    if (status === 'allowed' && isSuperadmin) loadData();
  }, [status, isSuperadmin, loadData]);

  const clientById = useMemo(() => {
    const map = {};
    clients.forEach((c) => { map[c.id] = c; });
    return map;
  }, [clients]);

  const rows = useMemo(() => {
    let list = invoices;
    if (statusFilter !== 'all') list = list.filter((i) => i.status === statusFilter);
    if (clientFilter !== 'all') list = list.filter((i) => i.client_id === clientFilter);
    return list;
  }, [invoices, statusFilter, clientFilter]);

  const totalOutstanding = useMemo(
    () => invoices.filter((i) => i.status !== 'lunas').reduce((sum, i) => sum + (Number(i.nominal) || 0), 0),
    [invoices]
  );

  const handleAdd = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!form.nomorSurat.trim()) {
      setFormError('Nomor surat wajib diisi.');
      return;
    }
    if (!form.nominal || Number(form.nominal) <= 0) {
      setFormError('Nominal wajib diisi dan harus lebih dari 0.');
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase
      .from('invoices')
      .insert([{
        client_id: form.clientId || null,
        nomor_surat: form.nomorSurat.trim(),
        nominal: Number(form.nominal),
        tanggal_terbit: form.tanggalTerbit,
        catatan: form.catatan.trim() || null,
        status: 'draft',
        created_by: employee.id,
      }])
      .select()
      .single();

    setSubmitting(false);
    if (error) {
      setFormError(error.message || 'Gagal menambahkan invoice.');
      return;
    }

    setInvoices((prev) => [data, ...prev]);
    setForm(emptyForm);
  };

  const handleStatusChange = async (row, newStatus) => {
    setUpdateError(null);
    setUpdatingId(row.id);

    const patch = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === 'lunas' && !row.tanggal_lunas) patch.tanggal_lunas = todayValue();
    if (newStatus !== 'lunas') patch.tanggal_lunas = null;

    const { data, error } = await supabase
      .from('invoices')
      .update(patch)
      .eq('id', row.id)
      .select()
      .single();

    setUpdatingId(null);
    if (error) {
      setUpdateError(error.message || 'Gagal memperbarui status invoice.');
      return;
    }
    setInvoices((prev) => prev.map((i) => (i.id === data.id ? data : i)));
  };

  if (status === 'loading') {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4]">
        <LoadingState label="Memuat data..." />
      </section>
    );
  }

  if (status === 'denied' || !isSuperadmin) {
    return (
      <section className="min-h-screen flex items-center justify-center bg-[#F4F4F4] px-6">
        <div className="w-full max-w-[420px] border-t-4 border-madael-red bg-white p-8 text-center">
          <p className="text-sm text-black mb-6">Halaman ini khusus superadmin.</p>
          <Link
            href="/employee/documents"
            className="inline-block bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
          >
            Kembali
          </Link>
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  const inputClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-10">
      <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Invoice & Billing Tracker</h1>
          <p className="text-sm text-[#6B6B6B] mt-1">Pantau status invoice per klien. Nomor surat diisi manual (belum terhubung otomatis ke Document Generator).</p>
        </div>
        <div className="bg-white border border-[#E0E0E0] px-5 py-3">
          <p className="text-[11px] text-[#9A9A9A] uppercase tracking-[0.04em]">Outstanding</p>
          <p className="text-lg font-medium text-black">{formatRupiah(totalOutstanding)}</p>
        </div>
      </div>

      <form onSubmit={handleAdd} className="bg-white border border-[#E0E0E0] p-4 mb-6">
        <p className="text-xs text-[#6B6B6B] mb-3">Tambah Invoice Manual</p>
        <div className="flex flex-wrap gap-2 items-start">
          <select
            value={form.clientId}
            onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
            className={inputClass}
          >
            <option value="">— Klien —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.nama_perusahaan}</option>
            ))}
          </select>
          <input
            placeholder="Nomor Surat"
            value={form.nomorSurat}
            onChange={(e) => setForm((f) => ({ ...f, nomorSurat: e.target.value }))}
            className={`${inputClass} w-44`}
          />
          <input
            type="number"
            placeholder="Nominal"
            value={form.nominal}
            onChange={(e) => setForm((f) => ({ ...f, nominal: e.target.value }))}
            className={`${inputClass} w-36`}
          />
          <input
            type="date"
            value={form.tanggalTerbit}
            onChange={(e) => setForm((f) => ({ ...f, tanggalTerbit: e.target.value }))}
            className={inputClass}
          />
          <input
            placeholder="Catatan (opsional)"
            value={form.catatan}
            onChange={(e) => setForm((f) => ({ ...f, catatan: e.target.value }))}
            className={`${inputClass} flex-1 min-w-[160px]`}
          />
          <button
            type="submit"
            disabled={submitting}
            className="bg-madael-red text-white px-4 py-2 text-xs font-medium tracking-[0.02em] hover:bg-madael-dark transition-colors disabled:opacity-50"
          >
            {submitting ? 'Menyimpan...' : 'Tambah'}
          </button>
        </div>
        {formError && <p className="text-xs text-red-600 mt-2">{formError}</p>}
      </form>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputClass}>
          <option value="all">Semua Status</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className={inputClass}>
          <option value="all">Semua Klien</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.nama_perusahaan}</option>
          ))}
        </select>
      </div>

      {updateError && <p className="text-xs text-red-600 mb-4">{updateError}</p>}

      {loading ? (
        <LoadingState label="Memuat invoice..." />
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Nomor Surat</th>
                <th className="px-4 py-3 font-medium">Klien</th>
                <th className="px-4 py-3 font-medium">Nominal</th>
                <th className="px-4 py-3 font-medium">Terbit</th>
                <th className="px-4 py-3 font-medium">Lunas</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-0">
                    <EmptyState message="Tidak ada invoice yang cocok dengan filter ini." />
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-[#E0E0E0] last:border-0">
                    <td className="px-4 py-3 text-black whitespace-nowrap">{row.nomor_surat}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{clientById[row.client_id]?.nama_perusahaan || '—'}</td>
                    <td className="px-4 py-3 text-black whitespace-nowrap">{formatRupiah(row.nominal)}</td>
                    <td className="px-4 py-3 text-[#6B6B6B] whitespace-nowrap">{formatTanggal(row.tanggal_terbit)}</td>
                    <td className="px-4 py-3 text-[#6B6B6B] whitespace-nowrap">{formatTanggal(row.tanggal_lunas)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={row.status}
                        onChange={(e) => handleStatusChange(row, e.target.value)}
                        disabled={updatingId === row.id}
                        className={`text-[11px] font-medium rounded px-2 py-1 border-0 focus:outline-none disabled:opacity-50 ${STATUS_STYLES[row.status]}`}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.status !== 'lunas' && (
                        <button
                          onClick={() => handleStatusChange(row, 'lunas')}
                          disabled={updatingId === row.id}
                          className="inline-flex items-center gap-1 text-xs text-green-700 hover:text-green-900 font-medium disabled:opacity-50"
                        >
                          <CheckCircle2 size={12} /> Tandai Lunas
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}