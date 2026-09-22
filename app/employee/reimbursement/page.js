'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { Banknote, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { notifySuperadmins } from '@/lib/notify';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

const KATEGORI_OPTIONS = [
  { value: 'transport', label: 'Transport' },
  { value: 'kesehatan', label: 'Kesehatan' },
  { value: 'lainnya', label: 'Lainnya' },
];

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

// Sama seperti formatNumberDisplay() di app/kalkulator-pph21 — state form
// menyimpan digit mentah tanpa titik, ini cuma format tampilannya.
// toLocaleString('id-ID') otomatis pakai titik sebagai pemisah ribuan.
function formatNumberDisplay(value) {
  if (value === '' || value === null || value === undefined) return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  return num.toLocaleString('id-ID');
}

function formatRupiah(value) {
  return 'Rp ' + Math.round(value || 0).toLocaleString('id-ID');
}

function formatTanggal(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }) {
  const map = {
    pending: 'bg-amber-100 text-amber-800',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    paid: 'bg-blue-100 text-blue-700',
  };
  const label = { pending: 'MENUNGGU', approved: 'DISETUJUI', rejected: 'DITOLAK', paid: 'SUDAH DIBAYAR' };
  return (
    <span className={`text-[10px] font-medium tracking-[0.04em] px-2 py-1 ${map[status] || 'bg-[#F4F4F4] text-[#6B6B6B]'}`}>
      {label[status] || status?.toUpperCase()}
    </span>
  );
}

export default function ReimbursementPage() {
  const supabase = createClient();

  const [employeeId, setEmployeeId] = useState(null);
  const [employeeName, setEmployeeName] = useState('');
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState({ kategori: 'transport', jumlah: '', deskripsi: '' });
  const [file, setFile] = useState(null);
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
      .select('id, nama')
      .eq('email', user.email)
      .maybeSingle();

    if (empError || !emp) {
      setLoadError(empError?.message || 'Data karyawan tidak ditemukan.');
      setLoading(false);
      return;
    }

    setEmployeeId(emp.id);
    setEmployeeName(emp.nama || '');

    const { data, error } = await supabase
      .from('reimbursement_requests')
      .select('*')
      .eq('employee_id', emp.id)
      .order('created_at', { ascending: false });

    if (error) {
      setLoadError(error.message || 'Gagal memuat riwayat reimbursement.');
      setLoading(false);
      return;
    }

    setRequests(data || []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleJumlahChange = (e) => {
    const raw = e.target.value.replace(/[^\d]/g, '');
    setForm((f) => ({ ...f, jumlah: raw }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSubmitSuccess(false);

    const jumlah = Number(form.jumlah);
    if (!jumlah || jumlah <= 0) {
      setFormError('Jumlah klaim wajib diisi dan lebih dari 0.');
      return;
    }
    if (!form.deskripsi.trim()) {
      setFormError('Deskripsi klaim wajib diisi.');
      return;
    }
    if (!file) {
  setFormError('Bukti/kuitansi wajib diupload.');
  return;
    }
    if (file.size > 10 * 1024 * 1024) {
    setFormError('Ukuran bukti maksimal 10MB.');
    return;
    }

    setSubmitting(true);

    let buktiPath = null;
    if (file) {
      buktiPath = `${employeeId}/${Date.now()}-${sanitizeFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from('reimbursement-bukti')
        .upload(buktiPath, file, { contentType: file.type || 'application/octet-stream' });
      if (uploadError) {
        setSubmitting(false);
        setFormError(uploadError.message || 'Gagal upload bukti.');
        return;
      }
    }

    const { data, error } = await supabase
      .from('reimbursement_requests')
      .insert([{
        employee_id: employeeId,
        kategori: form.kategori,
        jumlah,
        deskripsi: form.deskripsi.trim(),
        bukti_path: buktiPath,
        status: 'pending',
      }])
      .select()
      .single();

    setSubmitting(false);
    if (error) {
      setFormError(error.message || 'Gagal mengirim klaim, coba lagi.');
      return;
    }

    setRequests((prev) => [data, ...prev]);
    setForm({ kategori: 'transport', jumlah: '', deskripsi: '' });
    setFile(null);
    setSubmitSuccess(true);

    notifySuperadmins(supabase, {
      tipe: 'reimbursement_diajukan',
      pesan: `${employeeName || 'Karyawan'} mengajukan klaim reimbursement ${formatRupiah(data.jumlah)} (${data.kategori}).`,
      link: '/employee/reimbursement/admin',
    });
  };

  if (loading) {
    return (
      <div className="max-w-[700px] mx-auto px-6 py-10">
        <LoadingState label="Memuat data reimbursement..." />
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
      <div className="mb-6">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Ajukan Klaim Reimbursement</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">Isi form di bawah untuk mengajukan klaim biaya. Admin akan meninjau pengajuanmu.</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-[#E0E0E0] p-6 mb-10">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#6B6B6B]">Kategori</span>
            <select
              value={form.kategori}
              onChange={(e) => setForm((f) => ({ ...f, kategori: e.target.value }))}
              className={inputClass}
            >
              {KATEGORI_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[#6B6B6B]">Jumlah (Rp)</span>
            <input
              type="text"
              inputMode="numeric"
              value={formatNumberDisplay(form.jumlah)}
              onChange={handleJumlahChange}
              placeholder="150.000"
              className={inputClass}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 mb-4">
          <span className="text-xs text-[#6B6B6B]">Deskripsi</span>
          <textarea
            value={form.deskripsi}
            onChange={(e) => setForm((f) => ({ ...f, deskripsi: e.target.value }))}
            rows={3}
            placeholder="Contoh: Bensin kunjungan klien tanggal 10 September."
            className={`${inputClass} resize-none`}
          />
        </label>

        <label className="block text-xs text-[#6B6B6B] mb-1.5">Bukti / Kuitansi (wajib, maks 10MB)</label>
        <label className="flex items-center gap-2 border border-dashed border-[#E0E0E0] px-3 py-3 text-xs text-[#6B6B6B] mb-4 cursor-pointer hover:border-madael-red">
        <Upload size={14} />
        {file ? file.name : 'Pilih atau ambil foto/kuitansi (JPG/PNG/PDF, maks 10MB)'}
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            capture="environment"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="hidden"
          />
        </label>

        {formError && <p className="text-xs text-red-600 mb-4">{formError}</p>}
        {submitSuccess && <p className="text-xs text-green-700 mb-4">Klaim berhasil dikirim, menunggu persetujuan.</p>}

        <button
          type="submit"
          disabled={submitting}
          className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
        >
          {submitting ? 'Mengirim...' : 'Kirim Klaim'}
        </button>
      </form>

      <h2 className="text-sm font-medium text-black mb-3">Riwayat Klaim</h2>
      {requests.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Belum ada klaim reimbursement." icon={Banknote} />
        </div>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Kategori</th>
                <th className="px-4 py-3 font-medium">Jumlah</th>
                <th className="px-4 py-3 font-medium">Deskripsi</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b border-[#E0E0E0] last:border-0">
                  <td className="px-4 py-3 text-black whitespace-nowrap">{formatTanggal(r.created_at)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B] capitalize">{r.kategori}</td>
                  <td className="px-4 py-3 text-black whitespace-nowrap">{formatRupiah(r.jumlah)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B] max-w-[220px] truncate" title={r.deskripsi}>{r.deskripsi}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                    {r.status === 'rejected' && r.rejection_reason && (
                      <p className="text-[11px] text-[#9A9A9A] mt-1 max-w-[160px]" title={r.rejection_reason}>{r.rejection_reason}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}