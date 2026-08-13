'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Pencil, X } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';

const inputClass =
  'w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black focus:outline-none focus:border-madael-red';
const labelClass = 'block text-xs font-medium text-[#6B6B6B] mb-1';

function formatRupiah(value) {
  if (value === null || value === undefined || value === '') return '-';
  return 'Rp ' + Math.round(value).toLocaleString('id-ID');
}

function formatJam(value) {
  return value ? value.slice(0, 5) : '-';
}

function InfoRow({ label, value }) {
  return (
    <div>
      <span className="text-[#6B6B6B] text-xs block">{label}</span>
      <span className="text-black">{value}</span>
    </div>
  );
}

export default function EmployeeDetailPage() {
  const params = useParams();
  const supabase = createClient();
  const employeeId = params.id;

  const [employee, setEmployee] = useState(null);
  const [master, setMaster] = useState(null); // row employees_master, null kalau belum ada
  const [schedule, setSchedule] = useState(null); // row work_schedule, null kalau belum diatur
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState(null);

  const loadData = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError(null);

    const [
      { data: empData, error: empError },
      { data: masterData },
      { data: schedData },
      { data: companyData },
    ] = await Promise.all([
      supabase
        .from('employees')
        .select('id, nama, employee_id, email, client_id, status, is_superadmin, created_at, companies:client_id ( id, nama_perusahaan )')
        .eq('id', employeeId)
        .maybeSingle(),
      supabase.from('employees_master').select('id, posisi, status, gaji_pokok, tunjangan').eq('linked_employee_id', employeeId).maybeSingle(),
      supabase.from('work_schedule').select('jam_masuk, jam_pulang, hari_kerja').eq('employee_id', employeeId).maybeSingle(),
      supabase.from('companies').select('id, nama_perusahaan').order('nama_perusahaan', { ascending: true }),
    ]);

    if (empError || !empData) {
      setError(empError?.message || 'Karyawan tidak ditemukan.');
      setLoading(false);
      return;
    }

    setEmployee(empData);
    setMaster(masterData || null);
    setSchedule(schedData || null);
    setCompanies(companyData || []);
    setLoading(false);
  }, [supabase, employeeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ---- Edit ----

  const openEditModal = () => {
    setEditForm({
      nama: employee.nama || '',
      employee_id: employee.employee_id || '',
      client_id: employee.client_id || '',
      status: employee.status || 'Aktif',
      is_superadmin: !!employee.is_superadmin,
      posisi: master?.posisi || '',
      status_karyawan: master?.status || 'PHL',
      gaji_pokok: master?.gaji_pokok ?? 0,
      tunjangan: master?.tunjangan ?? 0,
    });
    setEditError(null);
    setShowEditModal(true);
  };

  const handleEditChange = (field, value) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setSavingEdit(true);
    setEditError(null);

    try {
      // Data akun login (employees) — lewat API supaya konsisten dengan
      // aturan akses (hanya superadmin) yang sudah ditegakkan di sana.
      const res = await fetch(`/api/employee/${employee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nama: editForm.nama,
          employee_id: editForm.employee_id,
          client_id: editForm.client_id,
          status: editForm.status,
          is_superadmin: editForm.is_superadmin,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditError(data.error || 'Gagal menyimpan data akun.');
        setSavingEdit(false);
        return;
      }

      // Data HR/payroll (employees_master) — hanya kalau row-nya sudah ada.
      // Kalau belum ada, arahkan ke Payroll Manager (bukan dibuat dari sini).
      if (master) {
        const { error: masterError } = await supabase
          .from('employees_master')
          .update({
            posisi: editForm.posisi.trim(),
            status: editForm.status_karyawan,
            gaji_pokok: editForm.gaji_pokok,
            tunjangan: editForm.tunjangan,
          })
          .eq('id', master.id);

        if (masterError) {
          setEditError('Data akun tersimpan, tapi gagal menyimpan data HR/payroll: ' + masterError.message);
          setSavingEdit(false);
          return;
        }
      }

      setShowEditModal(false);
      loadData();
    } catch (err) {
      setEditError('Terjadi kesalahan. Coba lagi.');
    }
    setSavingEdit(false);
  };

  if (loading) {
    return <div className="max-w-[1000px] mx-auto px-6 py-10"><p className="text-sm text-[#6B6B6B]">Memuat data karyawan...</p></div>;
  }

  if (error) {
    return (
      <div className="max-w-[1000px] mx-auto px-6 py-10">
        <p className="text-sm text-red-600 mb-4">{error}</p>
        <Link href="/employee/list" className="text-sm text-madael-red hover:text-madael-dark">← Kembali ke Employee List</Link>
      </div>
    );
  }

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-10">
      <Link href="/employee/list" className="inline-flex items-center gap-1.5 text-sm text-[#6B6B6B] hover:text-black mb-6">
        <ArrowLeft size={14} /> Kembali ke Employee List
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-serif text-[28px] font-normal text-black tracking-[-0.02em]">{employee.nama}</h1>
            <span
              className={`text-xs font-medium px-2.5 py-1 ${
                employee.status === 'Aktif' ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#F4F4F4] text-[#6B6B6B]'
              }`}
            >
              {employee.status}
            </span>
            {employee.is_superadmin && (
              <span className="text-xs font-medium px-2.5 py-1 bg-madael-red text-white">Superadmin</span>
            )}
          </div>
          <p className="text-sm text-[#6B6B6B]">
            {employee.employee_id || '—'} {employee.companies?.nama_perusahaan ? `· ${employee.companies.nama_perusahaan}` : ''} {master?.posisi ? `· ${master.posisi}` : ''}
          </p>
        </div>
        <button onClick={openEditModal} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-madael-red hover:bg-madael-dark transition-colors cursor-pointer border-0">
          <Pencil size={14} /> Edit
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Info Akun */}
        <div className="bg-white border border-[#E0E0E0] p-5">
          <p className="text-xs font-semibold text-black tracking-[0.02em] mb-4">Info Akun</p>
          <div className="flex flex-col gap-3 text-sm">
            <InfoRow label="Employee ID" value={employee.employee_id || '-'} />
            <InfoRow label="Email" value={employee.email || '-'} />
            <InfoRow label="Perusahaan" value={employee.companies?.nama_perusahaan || '-'} />
            <InfoRow label="Status Akun" value={employee.status} />
            <InfoRow label="Superadmin" value={employee.is_superadmin ? 'Ya' : 'Tidak'} />
          </div>
        </div>

        {/* Info HR & Payroll */}
        <div className="bg-white border border-[#E0E0E0] p-5">
          <p className="text-xs font-semibold text-black tracking-[0.02em] mb-4">HR & Payroll</p>
          {master ? (
            <div className="flex flex-col gap-3 text-sm">
              <InfoRow label="Posisi" value={master.posisi || '-'} />
              <InfoRow label="Status Karyawan" value={master.status || '-'} />
              <InfoRow label="Gaji Pokok" value={formatRupiah(master.gaji_pokok)} />
              <InfoRow label="Tunjangan" value={formatRupiah(master.tunjangan)} />
            </div>
          ) : (
            <p className="text-sm text-[#6B6B6B]">Belum ada data HR/payroll untuk karyawan ini.</p>
          )}
          <Link href="/employee/payroll" className="inline-block mt-4 text-xs text-madael-red hover:text-madael-dark font-medium">
            {master ? 'Kelola di Payroll Manager' : 'Isi di Payroll Manager'}
          </Link>
        </div>

        {/* Jadwal Kerja */}
        <div className="bg-white border border-[#E0E0E0] p-5">
          <p className="text-xs font-semibold text-black tracking-[0.02em] mb-4">Jadwal Kerja</p>
          {schedule ? (
            <div className="flex flex-col gap-3 text-sm">
              <InfoRow label="Jam Masuk" value={formatJam(schedule.jam_masuk)} />
              <InfoRow label="Jam Pulang" value={formatJam(schedule.jam_pulang)} />
              <InfoRow label="Hari Kerja" value={schedule.hari_kerja?.length ? schedule.hari_kerja.join(', ') : '-'} />
            </div>
          ) : (
            <p className="text-sm text-[#6B6B6B]">Belum diatur.</p>
          )}
          <Link href="/employee/absensi/jadwal" className="inline-block mt-4 text-xs text-madael-red hover:text-madael-dark font-medium">
            Atur di Absensi &gt; Jadwal
          </Link>
        </div>
      </div>

      {/* Modal Edit */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[1000] px-6">
          <div className="w-full max-w-[480px] bg-white border-t-4 border-madael-red p-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-serif text-[20px] font-normal text-black">Edit Karyawan</h2>
              <button onClick={() => setShowEditModal(false)} className="text-[#6B6B6B] hover:text-black">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <p className="text-xs font-semibold text-[#6B6B6B] tracking-[0.02em]">Akun</p>
              <div>
                <label className={labelClass}>Nama</label>
                <input
                  required
                  value={editForm.nama}
                  onChange={(e) => handleEditChange('nama', e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Employee ID</label>
                <input
                  value={editForm.employee_id}
                  onChange={(e) => handleEditChange('employee_id', e.target.value)}
                  placeholder="MDL0001"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input disabled value={employee.email} className={`${inputClass} bg-[#F4F4F4] text-[#9A9A9A] cursor-not-allowed`} />
                <p className="text-xs text-[#9A9A9A] mt-1">Email tidak bisa diubah di sini karena terhubung ke akun login.</p>
              </div>
              <div>
                <label className={labelClass}>Perusahaan</label>
                <select
                  value={editForm.client_id}
                  onChange={(e) => handleEditChange('client_id', e.target.value)}
                  className={inputClass}
                >
                  <option value="">— Pilih Perusahaan —</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.nama_perusahaan}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Status Akun</label>
                <select
                  value={editForm.status}
                  onChange={(e) => handleEditChange('status', e.target.value)}
                  className={inputClass}
                >
                  <option value="Aktif">Aktif</option>
                  <option value="Nonaktif">Nonaktif</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-black">
                <input
                  type="checkbox"
                  checked={editForm.is_superadmin}
                  onChange={(e) => handleEditChange('is_superadmin', e.target.checked)}
                />
                Superadmin
              </label>

              {master ? (
                <>
                  <p className="text-xs font-semibold text-[#6B6B6B] tracking-[0.02em] pt-2">HR & Payroll</p>
                  <div>
                    <label className={labelClass}>Posisi</label>
                    <input
                      value={editForm.posisi}
                      onChange={(e) => handleEditChange('posisi', e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Status Karyawan</label>
                    <select
                      value={editForm.status_karyawan}
                      onChange={(e) => handleEditChange('status_karyawan', e.target.value)}
                      className={inputClass}
                    >
                      <option value="PHL">PHL</option>
                      <option value="Tetap">Tetap</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Gaji Pokok</label>
                    <input
                      type="number"
                      value={editForm.gaji_pokok}
                      onChange={(e) => handleEditChange('gaji_pokok', Number(e.target.value))}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Tunjangan</label>
                    <input
                      type="number"
                      value={editForm.tunjangan}
                      onChange={(e) => handleEditChange('tunjangan', Number(e.target.value))}
                      className={inputClass}
                    />
                  </div>
                </>
              ) : (
                <p className="text-xs text-[#9A9A9A]">
                  Data HR/payroll belum ada — isi dulu di Payroll Manager sebelum bisa diedit dari sini.
                </p>
              )}

              {editError && <p className="text-sm text-madael-red">{editError}</p>}

              <button
                type="submit"
                disabled={savingEdit}
                className="w-full bg-madael-red text-white px-8 py-3 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}