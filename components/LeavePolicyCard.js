'use client';

import { useState } from 'react';

const inputClass =
  'w-full border border-[#E0E0E0] px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-madael-red transition-colors';

export function ringkasanKebijakan(k) {
  const bagian = [`Jatah dasar ${k.jatah_default} hari/tahun`];
  bagian.push(k.min_masa_kerja_bulan > 0 ? `berhak setelah ${k.min_masa_kerja_bulan} bulan bekerja` : 'langsung berhak sejak bergabung');
  bagian.push(k.proporsional_tahun_pertama ? 'jatah tahun pertama proporsional' : 'jatah tahun pertama penuh');
  bagian.push(k.carry_over_maks_hari > 0 ? `carry-over maks. ${k.carry_over_maks_hari} hari` : 'sisa tahun lalu hangus');
  return bagian.join(' · ');
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-[#6B6B6B] mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[#9A9A9A] mt-1">{hint}</span>}
    </label>
  );
}

// Kartu kebijakan kuota cuti di halaman Kelola Pengajuan Cuti. Semua pemegang
// modul melihat ringkasannya; hanya pemegang modul Payroll/superadmin
// (bisaUbah) yang bisa mengubah — dicek lagi di server (PUT /api/leave-policy).
export default function LeavePolicyCard({ kebijakan, versi, bisaUbah, onSaved, onConflict }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const mulaiEdit = () => {
    setForm({
      jatah_default: String(kebijakan.jatah_default),
      min_masa_kerja_bulan: String(kebijakan.min_masa_kerja_bulan),
      carry_over_maks_hari: String(kebijakan.carry_over_maks_hari),
      proporsional_tahun_pertama: kebijakan.proporsional_tahun_pertama,
    });
    setError(null);
    setEditing(true);
  };

  const set = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const simpan = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/leave-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, versi }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Gagal menyimpan kebijakan cuti.');
        if (res.status === 409) {
          setEditing(false);
          onConflict?.();
        }
        return;
      }
      onSaved(json);
      setEditing(false);
    } catch {
      setError('Gagal menyimpan kebijakan cuti. Periksa koneksi internet kamu.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-[#E0E0E0] p-5 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-black">Kebijakan Kuota Cuti</h2>
          <p className="text-xs text-[#6B6B6B] mt-1">{ringkasanKebijakan(kebijakan)}</p>
        </div>
        {bisaUbah && !editing && (
          <button
            type="button"
            onClick={mulaiEdit}
            className="border border-[#E0E0E0] text-black px-4 py-1.5 text-xs hover:border-madael-red transition-colors"
          >
            Ubah kebijakan
          </button>
        )}
      </div>

      {error && !editing && <p className="text-xs text-red-600 mt-3">{error}</p>}

      {editing && form && (
        <div className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Jatah dasar (hari/tahun)" hint="Dipakai kalau jatah karyawan di Payroll Manager kosong, dan untuk karyawan baru.">
              <input type="number" min="0" max="60" step="1" value={form.jatah_default} onChange={set('jatah_default')} className={inputClass} />
            </Field>
            <Field label="Masa kerja minimum (bulan)" hint="0 = langsung berhak. Isi 12 jika cuti tahunan baru terbuka setelah 12 bulan bekerja.">
              <input type="number" min="0" max="60" step="1" value={form.min_masa_kerja_bulan} onChange={set('min_masa_kerja_bulan')} className={inputClass} />
            </Field>
            <Field label="Carry-over maksimal (hari)" hint="0 = sisa tahun lalu hangus. Carry-over menambah jatah tahun berjalan dan tidak punya batas waktu pakai.">
              <input type="number" min="0" max="60" step="1" value={form.carry_over_maks_hari} onChange={set('carry_over_maks_hari')} className={inputClass} />
            </Field>
          </div>

          <label className="flex items-start gap-2 mt-4 text-sm text-black">
            <input
              type="checkbox"
              checked={form.proporsional_tahun_pertama}
              onChange={(e) => setForm((prev) => ({ ...prev, proporsional_tahun_pertama: e.target.checked }))}
              className="mt-0.5"
            />
            <span>
              Jatah tahun pertama proporsional
              <span className="block text-[11px] text-[#9A9A9A]">Jatah di tahun masuk dikali bulan tersisa / 12, dibulatkan ke bawah. Bulan masuk dihitung penuh.</span>
            </span>
          </label>

          <p className="text-[11px] text-[#9A9A9A] mt-4">
            Perubahan langsung memengaruhi sisa cuti semua karyawan. Cuti yang sudah disetujui tidak diubah.
          </p>

          {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

          <div className="flex justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="border border-[#E0E0E0] text-black px-5 py-2 text-sm hover:border-madael-red transition-colors disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={simpan}
              disabled={saving}
              className="bg-madael-red text-white px-5 py-2 text-sm font-medium tracking-[0.04em] hover:bg-madael-dark transition-colors disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
