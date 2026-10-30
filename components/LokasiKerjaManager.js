'use client';

// Kelola work_locations (kantor + lokasi klien) yang dipakai untuk validasi
// radius GPS saat clock-in/out di Absensi. Dirender sebagai tab "Lokasi Kerja"
// di app/employee/absensi/karyawan/page.js.

import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, MapPin, LocateFixed, Users, QrCode } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';
import LokasiQrDialog from '@/components/LokasiQrDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import { friendlyError } from '@/lib/errorMessage';
import { validateLokasiInput, LOKASI_RADIUS_MIN, LOKASI_RADIUS_MAX } from '@/lib/workLocationValidation';

const EMPTY_FORM = { nama: '', latitude: '', longitude: '', radius_meter: 150, aktif: true };

// Semua penulisan lokasi kerja lewat API route (divalidasi & dicek akses di
// server); browser hanya membaca. Return { ok, data } atau { ok: false, error }.
async function callApi(url, method, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: data?.error || 'Permintaan gagal. Silakan coba lagi.' };
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Koneksi bermasalah. Periksa internet kamu lalu coba lagi.' };
  }
}

const inputClass =
  'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors w-full';

export default function LokasiKerjaManager({ supabase }) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [locatingMe, setLocatingMe] = useState(false);
  const [qrLoc, setQrLoc] = useState(null); // lokasi yang dialog QR-nya sedang dibuka
  const [actionError, setActionError] = useState(null); // gagal ubah status / hapus dari tabel
  const [deleteTarget, setDeleteTarget] = useState(null); // lokasi yang menunggu konfirmasi hapus
  const [deleting, setDeleting] = useState(false);

  // Assignment lokasi -> karyawan. Karyawan yang belum di-assign ke lokasi
  // manapun tetap bisa absen (dicek ke semua lokasi aktif) — assignment cuma
  // mempersempit lokasi mana yang dipakai buat karyawan yang sudah diatur.
  const [employees, setEmployees] = useState([]);
  const [assignCounts, setAssignCounts] = useState({}); // { [work_location_id]: jumlah karyawan }
  const [assigningLoc, setAssigningLoc] = useState(null); // lokasi yang lagi dibuka modal assign-nya
  const [assignedIds, setAssignedIds] = useState(new Set()); // employee.id yang di-assign ke assigningLoc
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState(null);

  const loadLocations = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [locRes, empRes, mapRes] = await Promise.all([
      supabase.from('work_locations').select('*').order('created_at', { ascending: true }),
      supabase.from('employees').select('id, nama').eq('status', 'Aktif').order('nama'),
      supabase.from('employee_work_locations').select('work_location_id'),
    ]);
    if (locRes.error) {
      setLoadError(friendlyError(locRes.error, 'Gagal memuat daftar lokasi kerja.'));
      setLoading(false);
      return;
    }
    setLocations(locRes.data || []);
    setEmployees(empRes.error ? [] : empRes.data || []);
    const counts = {};
    (mapRes.error ? [] : mapRes.data || []).forEach((row) => {
      counts[row.work_location_id] = (counts[row.work_location_id] || 0) + 1;
    });
    setAssignCounts(counts);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { loadLocations(); }, [loadLocations]);

  const openAssign = async (loc) => {
    setAssigningLoc(loc);
    setAssignError(null);
    setAssignLoading(true);
    const { data, error } = await supabase
      .from('employee_work_locations')
      .select('employee_id')
      .eq('work_location_id', loc.id);
    if (error) {
      setAssignError(friendlyError(error, 'Gagal memuat karyawan yang sudah di-assign.'));
      setAssignedIds(new Set());
    } else {
      setAssignedIds(new Set((data || []).map((r) => r.employee_id)));
    }
    setAssignLoading(false);
  };

  const toggleAssignedEmployee = (employeeId) => {
    setAssignedIds((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  const handleSaveAssign = async () => {
    if (!assigningLoc) return;
    setAssignSaving(true);
    setAssignError(null);

    // Server menghitung selisih & memvalidasi karyawan (harus aktif).
    const res = await callApi(
      `/api/attendance/lokasi/${encodeURIComponent(assigningLoc.id)}/karyawan`,
      'PUT',
      { employeeIds: Array.from(assignedIds) }
    );
    if (!res.ok) {
      setAssignError(res.error);
      setAssignSaving(false);
      return;
    }

    setAssignSaving(false);
    setAssigningLoc(null);
    loadLocations();
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (loc) => {
    setEditingId(loc.id);
    setForm({
      nama: loc.nama,
      latitude: String(loc.latitude),
      longitude: String(loc.longitude),
      radius_meter: loc.radius_meter,
      aktif: loc.aktif,
    });
    setFormError(null);
    setShowForm(true);
  };

  const useMyLocation = () => {
    setLocatingMe(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          latitude: String(pos.coords.latitude),
          longitude: String(pos.coords.longitude),
        }));
        setLocatingMe(false);
      },
      () => {
        setFormError('Gagal mengambil lokasi kamu saat ini. Isi koordinat manual atau coba lagi.');
        setLocatingMe(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSave = async () => {
    setFormError(null);
    // Cek cepat di browser; aturan yang sama dijalankan ulang di server.
    const parsed = validateLokasiInput(form);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }

    setSaving(true);
    const res = editingId
      ? await callApi(`/api/attendance/lokasi/${encodeURIComponent(editingId)}`, 'PATCH', parsed.value)
      : await callApi('/api/attendance/lokasi', 'POST', parsed.value);
    setSaving(false);
    if (!res.ok) {
      setFormError(res.error);
      return;
    }

    setShowForm(false);
    loadLocations();
  };

  const handleToggleAktif = async (loc) => {
    setActionError(null);
    const res = await callApi(`/api/attendance/lokasi/${encodeURIComponent(loc.id)}`, 'PATCH', { aktif: !loc.aktif });
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    loadLocations();
  };

  // Tombol hanya membuka dialog konfirmasi; aksinya di executeDelete.
  const handleDelete = (loc) => setDeleteTarget(loc);

  const executeDelete = async (loc) => {
    setActionError(null);
    setDeleting(true);
    const res = await callApi(`/api/attendance/lokasi/${encodeURIComponent(loc.id)}`, 'DELETE');
    setDeleting(false);
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    loadLocations();
  };

  if (loading) return <LoadingState label="Memuat daftar lokasi kerja..." />;
  if (loadError) return <ErrorState message={loadError} onRetry={loadLocations} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <p className="text-xs text-[#6B6B6B] max-w-[520px]">
          Daftarkan kantor & lokasi klien di sini. Saat karyawan clock in/out, sistem mencocokkan
          koordinat GPS mereka ke titik terdekat — kalau di luar radius, absensinya tetap tercatat
          tapi ditandai untuk direview (lihat tab "Perlu Review"). Karyawan bisa di-assign ke lokasi
          tertentu lewat tombol "Karyawan" di tiap baris; karyawan yang belum di-assign tetap bisa
          absen seperti biasa (dicek ke semua lokasi aktif).
        </p>
        <button
          onClick={openAdd}
          className="shrink-0 inline-flex items-center gap-1.5 bg-madael-red text-white px-4 py-2 text-xs font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
        >
          <Plus size={14} /> Tambah Lokasi
        </button>
      </div>

      {actionError && <p className="text-xs text-red-600 mb-3">{actionError}</p>}

      {locations.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Belum ada lokasi kerja terdaftar. Absensi belum bisa dicek radiusnya." icon={MapPin} />
        </div>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Nama</th>
                <th className="px-4 py-3 font-medium">Koordinat</th>
                <th className="px-4 py-3 font-medium">Radius</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Karyawan</th>
                <th className="px-4 py-3 font-medium">QR</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => (
                <tr key={loc.id} className="border-b border-[#E0E0E0] last:border-0">
                  <td className="px-4 py-3 text-black">{loc.nama}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}</td>
                  <td className="px-4 py-3 text-[#6B6B6B]">{loc.radius_meter} m</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleAktif(loc)}
                      className={`text-[10px] font-medium tracking-[0.04em] px-2 py-1 ${
                        loc.aktif ? 'bg-green-100 text-green-700' : 'bg-[#F4F4F4] text-[#6B6B6B]'
                      }`}
                    >
                      {loc.aktif ? 'AKTIF' : 'NONAKTIF'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openAssign(loc)}
                      className="inline-flex items-center gap-1.5 text-xs text-[#6B6B6B] hover:text-black"
                    >
                      <Users size={13} />
                      {assignCounts[loc.id] || 0} karyawan
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setQrLoc(loc)}
                      className={`inline-flex items-center gap-1.5 text-xs ${
                        loc.qr_enabled ? 'text-green-700 hover:text-green-900' : 'text-[#6B6B6B] hover:text-black'
                      }`}
                    >
                      <QrCode size={13} />
                      {loc.qr_enabled ? 'Aktif' : 'Atur QR'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => openEdit(loc)} className="text-[#6B6B6B] hover:text-black">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => handleDelete(loc)} className="text-[#6B6B6B] hover:text-red-700">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {qrLoc && <LokasiQrDialog loc={qrLoc} onClose={() => setQrLoc(null)} onChanged={loadLocations} />}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6" onClick={() => setShowForm(false)}>
          <div className="bg-white w-full max-w-[420px] p-6 relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowForm(false)} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black">
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-4">{editingId ? 'Edit Lokasi' : 'Tambah Lokasi'}</h2>

            {formError && <p className="text-xs text-red-600 mb-3">{formError}</p>}

            <label className="flex flex-col gap-1 mb-3">
              <span className="text-xs text-[#6B6B6B]">Nama Lokasi</span>
              <input
                value={form.nama}
                onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))}
                placeholder="Contoh: Kantor Pusat, Klien PT Maju Jaya"
                className={inputClass}
              />
            </label>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Latitude</span>
                <input
                  value={form.latitude}
                  onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
                  placeholder="-6.123456"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Longitude</span>
                <input
                  value={form.longitude}
                  onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
                  placeholder="107.123456"
                  className={inputClass}
                />
              </label>
            </div>

            <button
              onClick={useMyLocation}
              disabled={locatingMe}
              className="w-full flex items-center justify-center gap-1.5 border border-[#E0E0E0] px-3 py-2 text-xs font-medium text-[#6B6B6B] hover:border-madael-red hover:text-black transition-colors mb-4 disabled:opacity-50"
            >
              <LocateFixed size={13} />
              {locatingMe ? 'Mengambil lokasi...' : 'Pakai Lokasi Saya Sekarang'}
            </button>

            <label className="flex flex-col gap-1 mb-4">
              <span className="text-xs text-[#6B6B6B]">Radius Toleransi (meter, {LOKASI_RADIUS_MIN}–{LOKASI_RADIUS_MAX})</span>
              <input
                type="number"
                min={LOKASI_RADIUS_MIN}
                max={LOKASI_RADIUS_MAX}
                step="1"
                value={form.radius_meter}
                onChange={(e) => setForm((f) => ({ ...f, radius_meter: e.target.value }))}
                className={inputClass}
              />
            </label>

            <label className="flex items-center gap-2 mb-5">
              <input
                type="checkbox"
                checked={form.aktif}
                onChange={(e) => setForm((f) => ({ ...f, aktif: e.target.checked }))}
              />
              <span className="text-xs text-[#6B6B6B]">Aktif (dipakai untuk cek radius)</span>
            </label>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      )}

      {assigningLoc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6" onClick={() => setAssigningLoc(null)}>
          <div className="bg-white w-full max-w-[420px] p-6 relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setAssigningLoc(null)} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black">
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-1">Karyawan di "{assigningLoc.nama}"</h2>
            <p className="text-xs text-[#6B6B6B] mb-4">
              Centang karyawan yang absennya dicek khusus ke lokasi ini. Karyawan yang tidak
              dicentang di lokasi manapun tetap bisa absen seperti biasa (dicek ke semua lokasi aktif).
            </p>

            {assignError && <p className="text-xs text-red-600 mb-3">{assignError}</p>}

            {assignLoading ? (
              <LoadingState label="Memuat karyawan..." />
            ) : employees.length === 0 ? (
              <p className="text-xs text-[#6B6B6B] mb-4">Belum ada karyawan aktif.</p>
            ) : (
              <div className="max-h-[280px] overflow-y-auto border border-[#E0E0E0] mb-4">
                {employees.map((emp) => (
                  <label
                    key={emp.id}
                    className="flex items-center gap-2 px-3 py-2 border-b border-[#E0E0E0] last:border-0 text-sm text-black cursor-pointer hover:bg-[#FAFAFA]"
                  >
                    <input
                      type="checkbox"
                      checked={assignedIds.has(emp.id)}
                      onChange={() => toggleAssignedEmployee(emp.id)}
                    />
                    {emp.nama}
                  </label>
                ))}
              </div>
            )}

            <button
              onClick={handleSaveAssign}
              disabled={assignSaving || assignLoading}
              className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {assignSaving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus Lokasi Kerja"
        message={
          deleteTarget && (
            <>
              Hapus lokasi <strong>{deleteTarget.nama}</strong>? Data absensi lama tidak berubah, cuma lokasi ini tidak dipakai lagi untuk cek radius ke depannya.
            </>
          )
        }
        confirmLabel="Hapus"
        busyLabel="Menghapus..."
        busy={deleting}
        onConfirm={async () => {
          await executeDelete(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
