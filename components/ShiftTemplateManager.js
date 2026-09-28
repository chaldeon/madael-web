'use client';

// Kelola Template Shift (nama + jam masuk/pulang + toleransi + hari kerja).
// Dirender sebagai tab "Template Shift" di app/employee/absensi/karyawan/page.js.
//
// Template hanyalah preset: saat di-assign ke karyawan, nilainya disalin ke
// work_schedule (lihat lib/shifts.js). Edit template menyebar ke semua karyawan
// yang tertaut; absensi yang sudah tercatat tidak berubah (forward-only).

import { useState } from 'react';
import { Plus, Pencil, Trash2, X, AlertTriangle } from 'lucide-react';
import { logActivity } from '@/lib/activityLog';
import { useModalDismiss } from '@/lib/useModalDismiss';
import { MAX_TOLERANSI_MENIT } from '@/lib/attendanceStatus';
import {
  HARI_OPTIONS, MAX_NAMA_SHIFT, durasiMenit, formatDurasi, formatJam,
  validateShiftForm, scheduleFieldsFromTemplate,
} from '@/lib/shifts';
import EmptyState from '@/components/EmptyState';

const EMPTY_FORM = {
  nama: '',
  jam_masuk: '08:00',
  jam_pulang: '16:00',
  toleransi_menit: '0',
  hari_kerja: ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'],
  aktif: true,
};

const inputClass =
  'border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors w-full';

function formFromTemplate(tpl) {
  return {
    nama: tpl.nama,
    jam_masuk: formatJam(tpl.jam_masuk),
    jam_pulang: formatJam(tpl.jam_pulang),
    toleransi_menit: String(tpl.toleransi_menit ?? 0),
    hari_kerja: tpl.hari_kerja || [],
    aktif: tpl.aktif !== false,
  };
}

export default function ShiftTemplateManager({ supabase, userId, templates, linkedCounts, unavailable, onChanged }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // template yang diedit, null = tambah baru
  const [form, setForm] = useState(EMPTY_FORM);
  const [baseline, setBaseline] = useState(EMPTY_FORM); // untuk dirty-check saat modal ditutup
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [listMsg, setListMsg] = useState(null); // { type: 'ok' | 'error', text }

  const closeForm = () => setShowForm(false);
  const handleBackdrop = useModalDismiss(
    showForm,
    closeForm,
    undefined,
    JSON.stringify(form) !== JSON.stringify(baseline)
  );

  if (unavailable) {
    return (
      <div className="flex items-start gap-2 bg-[#F4F4F4] border border-[#E0E0E0] text-[#6B6B6B] text-xs px-4 py-3">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        {unavailable}
      </div>
    );
  }

  const openAdd = () => {
    setEditing(null);
    setBaseline(EMPTY_FORM);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (tpl) => {
    const initial = formFromTemplate(tpl);
    setEditing(tpl);
    setBaseline(initial);
    setForm(initial);
    setFormError(null);
    setShowForm(true);
  };

  const toggleHari = (hari) => {
    setForm((f) => ({
      ...f,
      hari_kerja: f.hari_kerja.includes(hari) ? f.hari_kerja.filter((h) => h !== hari) : [...f.hari_kerja, hari],
    }));
  };

  const handleSave = async () => {
    const { error: invalid, value } = validateShiftForm(form);
    if (invalid) {
      setFormError(invalid);
      return;
    }

    const linked = editing ? linkedCounts[editing.id] || 0 : 0;
    if (linked > 0 && !window.confirm(
      `Template ini dipakai ${linked} karyawan. Perubahan jam/hari/toleransi akan langsung berlaku untuk mereka.\n\nHanya berlaku untuk absensi baru ke depan.`
    )) return;

    setSaving(true);
    setFormError(null);

    if (!editing) {
      const { data, error } = await supabase.from('shift_templates').insert([value]).select().single();
      setSaving(false);
      if (error) {
        setFormError(error.code === '23505' ? 'Nama shift itu sudah dipakai.' : error.message || 'Gagal menyimpan shift.');
        return;
      }
      logActivity(supabase, {
        userId, aksi: 'tambah_template_shift', targetTable: 'shift_templates', targetId: data.id,
        detail: { nama: value.nama, jam_masuk: value.jam_masuk, jam_pulang: value.jam_pulang },
      });
      setShowForm(false);
      setListMsg({ type: 'ok', text: `Shift "${value.nama}" ditambahkan.` });
      await onChanged();
      return;
    }

    const { data: updated, error } = await supabase
      .from('shift_templates').update(value).eq('id', editing.id).select().single();
    if (error) {
      setSaving(false);
      setFormError(error.code === '23505' ? 'Nama shift itu sudah dipakai.' : error.message || 'Gagal menyimpan shift.');
      return;
    }

    // Sebarkan ke jadwal karyawan yang tertaut. Idempoten: kalau gagal, menyimpan ulang
    // template yang sama akan mengulang penyebaran.
    let synced = 0;
    if (linked > 0) {
      const sync = await supabase
        .from('work_schedule')
        .update(scheduleFieldsFromTemplate(updated))
        .eq('shift_template_id', editing.id)
        .select('employee_id');
      if (sync.error) {
        setSaving(false);
        setFormError(`Template tersimpan, tapi gagal menyebar ke karyawan: ${sync.error.message}. Klik Simpan lagi untuk mengulang.`);
        await onChanged();
        return;
      }
      synced = (sync.data || []).length;
    }

    setSaving(false);
    logActivity(supabase, {
      userId, aksi: 'ubah_template_shift', targetTable: 'shift_templates', targetId: editing.id,
      detail: {
        before: { nama: editing.nama, jam_masuk: editing.jam_masuk, jam_pulang: editing.jam_pulang, toleransi_menit: editing.toleransi_menit, aktif: editing.aktif },
        after: value,
        karyawan_terdampak: synced,
      },
    });
    setShowForm(false);
    setListMsg({
      type: 'ok',
      text: `Shift "${value.nama}" diperbarui${synced > 0 ? ` dan diterapkan ke ${synced} karyawan` : ''}.`,
    });
    await onChanged();
  };

  const handleDelete = async (tpl) => {
    if (!window.confirm(`Hapus shift "${tpl.nama}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    const { error } = await supabase.from('shift_templates').delete().eq('id', tpl.id);
    if (error) {
      setListMsg({ type: 'error', text: error.message || 'Gagal menghapus shift.' });
      return;
    }
    logActivity(supabase, {
      userId, aksi: 'hapus_template_shift', targetTable: 'shift_templates', targetId: tpl.id,
      detail: { nama: tpl.nama },
    });
    setListMsg({ type: 'ok', text: `Shift "${tpl.nama}" dihapus.` });
    await onChanged();
  };

  const formDurasi = formatDurasi(durasiMenit(form.jam_masuk, form.jam_pulang));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <p className="text-xs text-[#6B6B6B] max-w-[560px]">
          Buat beberapa template shift, lalu pasang ke karyawan dari tab Jadwal Kerja (satu per satu, atau massal per
          perusahaan/cabang). Mengubah template akan ikut mengubah jadwal semua karyawan yang memakainya.
        </p>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 bg-madael-red text-white px-4 py-2 text-xs font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors"
        >
          <Plus size={14} />
          Tambah Shift
        </button>
      </div>

      {listMsg && (
        <div className={`text-xs px-3 py-2 mb-4 border ${
          listMsg.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'
        }`}>
          {listMsg.text}
        </div>
      )}

      {templates.length === 0 ? (
        <div className="bg-white border border-[#E0E0E0]">
          <EmptyState message="Belum ada template shift. Klik Tambah Shift untuk membuat yang pertama." />
        </div>
      ) : (
        <div className="bg-white border border-[#E0E0E0] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E0E0E0] text-left text-xs text-[#6B6B6B]">
                <th className="px-4 py-3 font-medium">Shift</th>
                <th className="px-4 py-3 font-medium">Jam</th>
                <th className="px-4 py-3 font-medium">Durasi</th>
                <th className="px-4 py-3 font-medium">Toleransi</th>
                <th className="px-4 py-3 font-medium">Hari Kerja</th>
                <th className="px-4 py-3 font-medium">Dipakai</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => {
                const count = linkedCounts[tpl.id] || 0;
                return (
                  <tr key={tpl.id} className="border-b border-[#E0E0E0] last:border-0">
                    <td className="px-4 py-3 text-black">
                      {tpl.nama}
                      {!tpl.aktif && <span className="ml-2 text-[10px] text-[#9A9A9A] border border-[#E0E0E0] px-1.5 py-0.5">NONAKTIF</span>}
                    </td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{formatJam(tpl.jam_masuk)}–{formatJam(tpl.jam_pulang)}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{formatDurasi(durasiMenit(tpl.jam_masuk, tpl.jam_pulang))}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{tpl.toleransi_menit} menit</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{(tpl.hari_kerja || []).join(', ')}</td>
                    <td className="px-4 py-3 text-[#6B6B6B]">{count} karyawan</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => openEdit(tpl)}
                        className="inline-flex items-center gap-1 text-xs text-madael-red hover:text-madael-dark font-medium mr-3"
                      >
                        <Pencil size={12} />
                        Edit
                      </button>
                      {count === 0 && (
                        <button
                          onClick={() => handleDelete(tpl)}
                          className="inline-flex items-center gap-1 text-xs text-[#9A9A9A] hover:text-red-600 font-medium"
                        >
                          <Trash2 size={12} />
                          Hapus
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000] px-6" onClick={handleBackdrop}>
          <div className="bg-white w-full max-w-[440px] p-6 relative max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <button onClick={closeForm} className="absolute top-4 right-4 text-[#9A9A9A] hover:text-black">
              <X size={18} />
            </button>
            <h2 className="text-sm font-medium text-black mb-4">{editing ? `Edit Shift — ${editing.nama}` : 'Tambah Shift'}</h2>

            <label className="flex flex-col gap-1 mb-4">
              <span className="text-xs text-[#6B6B6B]">Nama Shift</span>
              <input
                type="text"
                maxLength={MAX_NAMA_SHIFT}
                placeholder="mis. Shift Pagi"
                value={form.nama}
                onChange={(e) => setForm((f) => ({ ...f, nama: e.target.value }))}
                className={inputClass}
              />
            </label>

            <div className="grid grid-cols-2 gap-3 mb-1">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Jam Masuk</span>
                <input type="time" value={form.jam_masuk} onChange={(e) => setForm((f) => ({ ...f, jam_masuk: e.target.value }))} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#6B6B6B]">Jam Pulang</span>
                <input type="time" value={form.jam_pulang} onChange={(e) => setForm((f) => ({ ...f, jam_pulang: e.target.value }))} className={inputClass} />
              </label>
            </div>
            <p className="text-[11px] text-[#9A9A9A] mb-4">Durasi: {formDurasi}</p>

            <span className="text-xs text-[#6B6B6B] block mb-2">Hari Kerja</span>
            <div className="flex flex-wrap gap-2 mb-4">
              {HARI_OPTIONS.map((hari) => {
                const active = form.hari_kerja.includes(hari);
                return (
                  <button
                    key={hari}
                    type="button"
                    onClick={() => toggleHari(hari)}
                    className={`px-3 py-1.5 text-xs border transition-colors ${
                      active ? 'bg-madael-red text-white border-madael-red' : 'bg-white text-[#6B6B6B] border-[#E0E0E0]'
                    }`}
                  >
                    {hari}
                  </button>
                );
              })}
            </div>

            <label className="flex flex-col gap-1 mb-4">
              <span className="text-xs text-[#6B6B6B]">Toleransi (menit)</span>
              <input
                type="number" min="0" max={MAX_TOLERANSI_MENIT} step="1"
                value={form.toleransi_menit}
                onChange={(e) => setForm((f) => ({ ...f, toleransi_menit: e.target.value }))}
                className={inputClass}
              />
              <span className="text-[11px] text-[#9A9A9A]">0 = tanpa toleransi.</span>
            </label>

            <label className="flex items-center gap-2 mb-6 text-xs text-[#6B6B6B]">
              <input type="checkbox" checked={form.aktif} onChange={(e) => setForm((f) => ({ ...f, aktif: e.target.checked }))} />
              Aktif (bisa dipilih saat assign shift baru)
            </label>

            {formError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 mb-3">{formError}</div>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-madael-red text-white px-6 py-2.5 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan Shift'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}