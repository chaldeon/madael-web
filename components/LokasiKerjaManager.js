'use client';

// Kelola work_locations (kantor + lokasi klien) yang dipakai untuk validasi
// radius GPS saat clock-in/out di Absensi. Dirender sebagai tab "Lokasi Kerja"
// di app/employee/absensi/karyawan/page.js.

import { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, MapPin, LocateFixed, Users } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import EmptyState from '@/components/EmptyState';

const EMPTY_FORM = { nama: '', latitude: '', longitude: '', radius_meter: 150, aktif: true };

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
      setLoadError(locRes.error.message || 'Gagal memuat daftar lokasi kerja.');
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
      setAssignError(error.message || 'Gagal memuat karyawan yang sudah di-assign.');
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

    // Ganti seluruh assignment untuk lokasi ini: hapus semua baris lama punya
    // lokasi ini, lalu insert ulang sesuai centang saat ini. Lebih sederhana
    // & aman daripada diff manual, dan datanya kecil (per lokasi per karyawan).
    const del = await supabase.from('employee_work_locations').delete().eq('work_location_id', assigningLoc.id);
    if (del.error) {
      setAssignError(del.error.message || 'Gagal menyimpan assignment.');
      setAssignSaving(false);
      return;
    }

    const rows = Array.from(assignedIds).map((employeeId) => ({
      employee_id: employeeId,
      work_location_id: assigningLoc.id,
    }));
    if (rows.length > 0) {
      const ins = await supabase.from('employee_work_locations').insert(rows);
      if (ins.error) {
        setAssignError(ins.error.message || 'Gagal menyimpan assignment.');
        setAssignSaving(false);
        return;
      }
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
    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);
    const radius = parseInt(form.radius_meter, 10);

    if (!form.nama.trim()) {
      setFormError('Nama lokasi wajib diisi.');
      return;
    }
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setFormError('Koordinat latitude/longitude tidak valid.');
      return;
    }
    if (Number.isNaN(radius) || radius <= 0) {
      setFormError('Radius harus angka positif (meter).');
      return;
    }

    setSaving(true);
    const payload = {
      nama: form.nama.trim(),
      latitude: lat,
      longitude: lng,
      radius_meter: radius,
      aktif: form.aktif,
    };

    const { error } = editingId
      ? await supabase.from('work_locations').update(payload).eq('id', editingId)
      : await supabase.from('work_locations').insert([payload]);

    setSaving(false);
    if (error) {
      setFormError(error.message || 'Gagal menyimpan lokasi.');
      return;
    }

    setShowForm(false);
    loadLocations();
  };

  const handleToggleAktif = async (loc) => {
    await supabase.from('work_locations').update({ aktif: !loc.aktif }).eq('id', loc.id);
    loadLocations();
  };

  const handleDelete = async (loc) => {
    if (!window.confirm(`Hapus lokasi "${loc.nama}"? Data absensi lama tidak berubah, cuma lokasi ini tidak dipakai lagi untuk cek radius ke depannya.`)) {
      return;
    }
    await supabase.from('work_locations').delete().eq('id', loc.id);
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
              <span className="text-xs text-[#6B6B6B]">Radius Toleransi (meter)</span>
              <input
                type="number"
                min="1"
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
    </div>
  );
}