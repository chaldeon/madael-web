'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { UserCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { notifySuperadmins } from '@/lib/notify';
import { PROFILE_EDITABLE_FIELDS, fieldLabel } from '@/lib/profileFields';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

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

const inputClass =
  'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors w-full';
const labelClass = 'block text-xs text-[#6B6B6B] mb-1';

export default function ProfilePage() {
  const supabase = createClient();

  const [employeeId, setEmployeeId] = useState(null);
  const [employeeName, setEmployeeName] = useState('');
  const [master, setMaster] = useState(null); // row employees_master, null kalau belum di-link
  const [form, setForm] = useState({});
  const [catatan, setCatatan] = useState('');
  const [requests, setRequests] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
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

    const [masterRes, reqRes] = await Promise.all([
      supabase
        .from('employees_master')
        .select('id, posisi, status, gaji_pokok, tunjangan, alamat, kontak_darurat_nama, kontak_darurat_hubungan, kontak_darurat_telepon, nama_rekening, no_rekening, npwp_status, npwp, no_bpjs_kesehatan, no_bpjs_ketenagakerjaan')
        .eq('linked_employee_id', emp.id)
        .maybeSingle(),
      supabase
        .from('profile_change_requests')
        .select('*')
        .eq('employee_id', emp.id)
        .order('created_at', { ascending: false }),
    ]);

    if (reqRes.error) {
      setLoadError(reqRes.error.message || 'Gagal memuat riwayat pengajuan.');
      setLoading(false);
      return;
    }

    const masterData = masterRes.data || null;
    setMaster(masterData);
    setRequests(reqRes.data || []);

    const initialForm = {};
    PROFILE_EDITABLE_FIELDS.forEach((f) => {
      initialForm[f.key] = masterData?.[f.key] ?? '';
    });
    setForm(initialForm);

    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleFieldChange = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    setSubmitSuccess(false);

    if (!master) {
      setFormError('Akunmu belum terhubung ke data master karyawan.');
      return;
    }

    // Hanya kirim field yang benar-benar berubah dibanding data master saat ini.
    const fieldChanges = {};
    PROFILE_EDITABLE_FIELDS.forEach((f) => {
      const before = master[f.key] ?? '';
      const after = (form[f.key] ?? '').toString().trim();
      if (after !== (before ?? '').toString().trim()) {
        fieldChanges[f.key] = { before: before || null, after: after || null };
      }
    });

    if (Object.keys(fieldChanges).length === 0) {
      setFormError('Tidak ada perubahan untuk diajukan.');
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase
      .from('profile_change_requests')
      .insert([{
        employee_id: employeeId,
        master_id: master.id,
        field_changes: fieldChanges,
        catatan_karyawan: catatan.trim() || null,
        status: 'pending',
      }])
      .select()
      .single();

    setSubmitting(false);
    if (error) {
      setFormError(error.message || 'Gagal mengirim pengajuan, coba lagi.');
      return;
    }

    setRequests((prev) => [data, ...prev]);
    setCatatan('');
    setSubmitSuccess(true);

    notifySuperadmins(supabase, {
      tipe: 'profil_diajukan',
      pesan: `${employeeName || 'Karyawan'} mengajukan perubahan profil (${Object.keys(fieldChanges).map(fieldLabel).join(', ')}).`,
      link: '/employee/profile/admin',
    });
  };

  if (loading) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-10">
        <LoadingState label="Memuat data profil..." />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-10">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  return (
    <div className="max-w-[800px] mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">Profil Saya</h1>
        <p className="text-sm text-[#6B6B6B] mt-1">
          Update alamat, kontak darurat, rekening, NPWP, dan BPJS. Perubahan perlu disetujui superadmin sebelum berlaku.
        </p>
      </div>

      {/* Data read-only — hanya diubah superadmin lewat Payroll Manager */}
      <div className="bg-white border border-[#E0E0E0] p-5 mb-6">
        <p className="text-xs font-semibold text-black tracking-[0.02em] mb-4">Data HR (read-only)</p>
        {master ? (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-[#6B6B6B] text-xs block">Posisi</span><span className="text-black">{master.posisi || '-'}</span></div>
            <div><span className="text-[#6B6B6B] text-xs block">Status Karyawan</span><span className="text-black">{master.status || '-'}</span></div>
          </div>
        ) : (
          <p className="text-sm text-[#6B6B6B]">
            Akunmu belum terhubung ke data master karyawan. Minta superadmin buka
            <span className="font-medium"> Payroll Manager → Edit → Akun Absensi</span> lalu pilih namamu — setelah itu form di bawah bisa dipakai.
          </p>
        )}
        <p className="text-xs text-[#9A9A9A] mt-3">Gaji, tunjangan, dan status kontrak tidak bisa diajukan lewat halaman ini — hubungi superadmin.</p>
      </div>

      {/* Form pengajuan perubahan */}
      {master && (
        <form onSubmit={handleSubmit} className="bg-white border border-[#E0E0E0] p-6 mb-10">
          <p className="text-xs font-semibold text-black tracking-[0.02em] mb-4">Ajukan Perubahan</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            {PROFILE_EDITABLE_FIELDS.map((f) => (
              <label key={f.key} className={`flex flex-col gap-1 ${f.type === 'textarea' ? 'col-span-2' : ''}`}>
                <span className={labelClass}>{f.label}</span>
                {f.type === 'textarea' ? (
                  <textarea
                    rows={2}
                    value={form[f.key] ?? ''}
                    onChange={(e) => handleFieldChange(f.key, e.target.value)}
                    className={`${inputClass} resize-none`}
                  />
                ) : f.type === 'select' ? (
                  <select
                    value={form[f.key] ?? ''}
                    onChange={(e) => handleFieldChange(f.key, e.target.value)}
                    className={inputClass}
                  >
                    {f.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={form[f.key] ?? ''}
                    onChange={(e) => handleFieldChange(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className={inputClass}
                  />
                )}
              </label>
            ))}
          </div>

          <label className="flex flex-col gap-1 mb-4">
            <span className={labelClass}>Catatan (opsional)</span>
            <textarea
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              rows={2}
              placeholder="Contoh: rekening ganti karena bank lama ditutup."
              className={`${inputClass} resize-none`}
            />
          </label>

          {formError && <p className="text-xs text-red-600 mb-4">{formError}</p>}
          {submitSuccess && <p className="text-xs text-green-700 mb-4">Pengajuan berhasil dikirim, menunggu persetujuan superadmin.</p>}

          <button
            type="submit"
            disabled={submitting}
            className="bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
          >
            {submitting ? 'Mengirim...' : 'Ajukan Perubahan'}
          </button>
        </form>
      )}

      <h2 className="text-sm font-medium text-black mb-3">Riwayat Pengajuan</h2>
      {requests.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Belum ada pengajuan perubahan profil." icon={UserCircle} />
        </div>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Tanggal</th>
                <th className="px-4 py-3 font-medium">Field</th>
                <th className="px-4 py-3 font-medium">Catatan Reviewer</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b border-[#E0E0E0] last:border-0">
                  <td className="px-4 py-3 text-black whitespace-nowrap">
                    {new Date(r.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-[#6B6B6B]">
                    {Object.keys(r.field_changes || {}).map(fieldLabel).join(', ')}
                  </td>
                  <td className="px-4 py-3 text-[#6B6B6B] max-w-[220px] truncate" title={r.catatan_reviewer}>{r.catatan_reviewer || '-'}</td>
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
