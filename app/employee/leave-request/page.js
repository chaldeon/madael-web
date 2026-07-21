'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { CalendarDays } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value + 'T00:00:00').toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function hitungJumlahHari(mulai, selesai) {
  if (!mulai || !selesai) return 0;
  const d1 = new Date(mulai + 'T00:00:00');
  const d2 = new Date(selesai + 'T00:00:00');
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24)) + 1;
}

function StatusBadge({ status }) {
  const map = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
  };
  const label = { pending: 'MENUNGGU', approved: 'DISETUJUI', rejected: 'DITOLAK' };
  return (
    <span className={`text-[10px] font-medium tracking-[0.04em] px-2 py-1 ${map[status] || 'bg-[#F4F4F4] text-[#6B6B6B]'}`}>
      {label[status] || status?.toUpperCase()}
    </span>
  );
}

export default function LeaveRequestPage() {
  const supabase = createClient();

  const [employeeId, setEmployeeId] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState({ tanggalMulai: '', tanggalSelesai: '', alasan: '' });
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoadError('Sesi login tidak ditemukan. Silakan login ulang.');
      setLoading(false);
      return;
    }

    const { data: emp, error: empError } = await supabase
      .from('employees')
      .select('id')
      .eq('email', user.email)
      .maybeSingle();

    if (empError || !emp) {
      setLoadError(empError?.message || 'Data karyawan tidak ditemukan.');
      setLoading(false);
      return;
    }

    setEmployeeId(emp.id);

    const { data: reqs, error: reqError } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', emp.id)
      .order('created_at', { ascending: false });

    if (reqError) {
      setLoadError(reqError.message || 'Gagal memuat riwayat pengajuan cuti.');
      setLoading(false);
      return;
    }

    setRequests(reqs || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSubmitSuccess(false);

    if (!form.tanggalMulai || !form.tanggalSelesai) {
      setFormError('Tanggal mulai dan tanggal selesai wajib diisi.');
      return;
    }
    if (form.tanggalSelesai < form.tanggalMulai) {
      setFormError('Tanggal selesai tidak boleh sebelum tanggal mulai.');
      return;
    }
    if (!form.alasan.trim()) {
      setFormError('Alasan cuti wajib diisi.');
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase
      .from('leave_requests')
      .insert([{
        employee_id: employeeId,
        tanggal_mulai: form.tanggalMulai,
        tanggal_selesai: form.tanggalSelesai,
        alasan: form.alasan.trim(),
        status: 'pending',
      }])
      .select()
      .single();

    setSubmitting(false);
    if (error) {
      setFormError(error.message || 'Gagal mengirim pengajuan cuti, coba lagi.');
      return;
    }

    setRequests((prev) => [data, ...prev]);
    setForm({ tanggalMulai: '', tanggalSelesai: '', alasan: '' });
    setSubmitSuccess(true);
  };

  if (loading) {
    return (
      <div className="max-w-[700px] mx-auto px-6 py-10">
        <LoadingState label="Memuat data cuti..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[700px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  const inputClass =
    'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors w-full';

  return (
    <div className="max-w-[700px] mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Ajukan Cuti</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">Isi form di bawah untuk mengajukan cuti. Atasan akan meninjau pengajuanmu.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-[#E0E0E0] p-6 mb-10">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#6B6B6B]">Tanggal Mulai</span>
            <input
              type="date"
              value={form.tanggalMulai}
              onChange={(e) => setForm((f) => ({ ...f, tanggalMulai: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#6B6B6B]">Tanggal Selesai</span>
            <input
              type="date"
              value={form.tanggalSelesai}
              onChange={(e) => setForm((f) => ({ ...f, tanggalSelesai: e.target.value }))}
              className={inputClass}
            />
          </label>
        </div>

        {form.tanggalMulai && form.tanggalSelesai && form.tanggalSelesai >= form.tanggalMulai && (
          <p className="text-xs text-[#6B6B6B] mb-4">
            Total: {hitungJumlahHari(form.tanggalMulai, form.tanggalSelesai)} hari
          </p>
        )}

        <label className="flex flex-col gap-1 mb-4">
          <span className="text-xs text-[#6B6B6B]">Alasan</span>
          <textarea
            value={form.alasan}
            onChange={(e) => setForm((f) => ({ ...f, alasan: e.target.value }))}
            rows={3}
            placeholder="Contoh: Cuti tahunan, keperluan keluarga."
            className={`${inputClass} resize-none`}
          />
        </label>

        {formError && <p className="text-xs text-red-600 mb-4">{formError}</p>}
        {submitSuccess && <p className="text-xs text-green-700 mb-4">Pengajuan cuti berhasil dikirim, menunggu persetujuan.</p>}

        <button
          type="submit"
          disabled={submitting}
          className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
        >
          {submitting ? 'Mengirim...' : 'Ajukan Cuti'}
        </button>
      </form>

      <h2 className="text-sm font-medium text-black mb-3">Riwayat Pengajuan</h2>
      {requests.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Belum ada pengajuan cuti." icon={CalendarDays} />
        </div>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Periode</th>
                <th className="px-4 py-3 font-medium">Hari</th>
                <th className="px-4 py-3 font-medium">Alasan</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b border-[#E0E0E0] last:border-0">
                  <td className="px-4 py-3 text-black whitespace-nowrap">
                    {formatTanggal(r.tanggal_mulai)} — {formatTanggal(r.tanggal_selesai)}
                  </td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{hitungJumlahHari(r.tanggal_mulai, r.tanggal_selesai)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B] max-w-[220px] truncate" title={r.alasan}>{r.alasan}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}